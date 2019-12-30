var bcrypt = require("bcryptjs");
var https = require("https");
var async = require("async");
var assert = require("assert");
var ObjectId = require("mongodb").ObjectID;
var MongoClient = require("mongodb").MongoClient;

var globalNewsDoc;
const NEWYORKTIMES_CATEGORIES = [
  "home",
  "world",
  "national",
  "business",
  "techonology"
];

// Mongo DB connection initialize
var db = {};
MongoClient.connect(process.env.MONGODB_CONNECT_URL, function(err, client) {
  assert(null, err);
  db.client = client;
  db.collection = client.db("newswatcherdb").collection("newswatcher");
  console.log("Fork is connected to MongoDB server");
});

process.on("SIGINT", function() {
  console.log("MongoDB connection close on app termination");
  db.dbConnection.close();
  process.exit(0);
});

process.on("SIGUSR2", function() {
  console.log("MongoDB connection close on app restart");
  db.dbConnection.close();
  process.kill(process.pid, "SIGUSR2");
});

var newsPullBackgroundTimer;
var staleStoryDeleteBackgroundTimer;

console.log({ msg: "FORK_RUNNING" });

process.on("uncaughtException", function(err) {
  console.log({
    msg: "RESTART_FORK",
    Error:
      "app_FORK.js uncaughtException error: " + err.message + "\n" + err.stack
  });
  clearInterval(newsPullBackgroundTimer);
  clearInterval(staleStoryDeleteBackgroundTimer);
  process.disconnect();
});

process.on("message", function(m) {
  if (m.msg) {
    if (m.msg === "REFRESH_STORIES") {
      setImmediate(function(doc) {
        refreshStoriesMSG(doc, null);
      }, m.doc);
    }
  } else {
    console.log("Message from master", m);
  }
});

function refreshStoriesMSG(doc, callback) {
  if (!globalNewsDoc) {
    db.collection.findOne({ _id: process.env.GLOBAL_STORIES_ID }, function(
      err,
      gDoc
    ) {
      if (err) {
        console.log("FORK_ERROR: readDocument() read err:" + err);
        if (callbak) {
          return callback(err);
        } else {
          return;
        }
      } else {
        globalNewsDoc = gDoc;
        refreshStories(doc, callback);
      }
    });
  } else {
    refreshStories(doc, callback);
  }
}

function refreshStories(doc, callback) {
  // Loop through all newsFiters and seek matched for all returned stories
  for (var filterIdx = 0; filterIdx < doc.newsFilters.length; filterIdx++) {
    doc.newsFilters[filterIdx].newsStories = [];
    for (var i = 0; i < globalNewsDoc.newsStories.length; i++) {
      globalNewsDoc.newsStories[i].keep = false;
    }

    // If there are keyWords then filter by them
    if ("keyWords" in doc.newsFilters[filterIdx].keyWords[0] != "") {
      var storiesMatched = 0;
      for (var i = 0; i < doc.newsFilters[filterIdx].keyWords.length; i++) {
        for (var j = 0; j < globalNewsDoc.newsStories.length; j++) {
          if (globalNewsDoc.newsStories[j].keep === false) {
            var s1 = globalNewsDoc.newsStories[j].title.toLowerCase();
            var s2 = globalNewsDoc.newsStories[j].contentSnippet.toLowerCase();
            var keyword = doc.newsFilters[filterIdx].keyWords[i].toLowerCase();
            if (s1.indexOf(keyword) >= 0 || s2.indexOf(keyword) >= 0) {
              globalNewsDoc.newsStories[i].keep = true;
              storiesMatched++;
            }
          }

          if (storiesMatched === process.env.MAX_FILTER_STORIES) {
            break;
          }
        }

        if (storiesMatched == process.env.MAX_FILTER_STORIES) {
          break;
        }
      }

      for (var k = 0; k < globalNewsDoc.newsStories.length; k++) {
        if (globalNewsDoc.newsStories[k].keep === true) {
          doc.newsFilters[filterIdx].newsStories.push(
            globalNewsDoc.newsStories[k]
          );
        }
      }
    }
  }

  // For the test runs, we can inject news stories under our control
  if (
    doc.newsFilters.length === 1 &&
    doc.newsFilters[0].keyWords.length === 1 &&
    doc.newsFilters[0].keyWords[0] === "testingKeyword"
  ) {
    for (var i = 0; i < 5; i++) {
      doc.newsFilters[0].newsStories.push(globalNewsDoc.newsStories[0]);
      doc.newsFilters[0].newsStories[0].title = "testingKeyword title " + i;
    }
  }

  // Do the replacement of the news stories
  db.collection.findOneAndUpdate(
    { _id: ObjectId(doc._id) },
    {
      $set: { newsFilters: doc.newsFilters }
    },
    function(err, result) {
      if (err) {
        console.log("FORK ERROR Replace of newsStories failed: ", err);
      } else if (result.ok != 1) {
        console.log("FORK_ERROR Replace of newsStories failed:", result);
      } else {
        if (doc.newsFilters.length > 0) {
          console.log({
            msg:
              "MASTERNEWS_UPDATE first filter news length = " +
              doc.newsFilters[0].newsStories.length
          });
        } else {
          console.log({ msg: "MASTERNEWS_UPDATE	no newsFilters" });
        }
      }

      if (callback) {
        return callback(err);
      }
    }
  );
}

//
// Refresh all of the news stories in the master list every 15 minutes
//
var count = 0;
newsPullBackgroundTimer = setInterval(function() {
  // The New York Times news service can't be called more than five
  // times a second. We call it over and over again, because there are
  // multiple news category is, so space each out by half a second
  var date = new Date();
  console.log("app_FORK:datetime tick: ", date.toUTCString());
  async.timesSeries(
    NEWYORKTIMES_CATEGORIES.length,
    function(n, next) {
      setTimeout(function() {
        console.log("Get news stories from NYT. Pass #", n);
        try {
          https
            .get(
              {
                host: "api.nytimes.com",
                path:
                  "/svc/topstories/v2/" + NEWYORKTIMES_CATEGORIES[n] + ".json",
                headers: { "api-key": process.env.NEWYORKTIMES_API_KEY }
              },
              function(res) {
                var body = "";
                res.on("data", function(d) {
                  body += d;
                });
                res.on("end", next(null, body));
              }
            )
            .on("error", function(err) {
              // handle errors with the request itself
              console.log({ msg: "FORK_ERROR", Error: err.message });
              return;
            });
        } catch (err) {
          count++;
          if (count === 3) {
            console.log("app_FORK.js: shuting down timer: ", err);
            clearInterval(newsPullBackgroundTimer);
            clearInterval(staleStoryDeleteBackgroundTimer);
            process.disconnect();
          } else {
            console.log("app_FORK.js error. err: ", err);
          }
        }
      }, 500);
    },
    function(err, results) {
      if (err) {
        console.log("failure");
      } else {
        console.log("success");
        // Do the replacement of the news stories in the single master doc
        db.collection.findOne({ _id: process.env.GLOBAL_STORIES_ID }, function(
          err,
          gDoc
        ) {
          if (err) {
            console.log({
              msg: "FORK_ERROR",
              Error:
                "Error with global news doc read request: " +
                JSON.stringify(err.body, null, 4)
            });
          } else {
            gDoc.newsStories = [];
            gDoc.homeNewsStories = [];
            var allNews = [];
            for (var i = 0; i < results.length; i++) {
              try {
                var news = JSON.parse(results[i]);
              } catch (e) {
                console.error(e);
                return;
              }

              for (var j = 0; j < news.results.length; j++) {
                var xferNewsStory = {
                  link: news.results[j].url,
                  title: news.results[j].title,
                  contentSnippet: news.results[j].abstract,
                  source: news.results[j].section,
                  date: new Date(news.results[j].updated_date).getTime()
                };

                // Only take stories with images
                if (news.results[j].multimedia.length > 0) {
                  xferNewsStory.imageUrl = news.results[j].multimedia[0].url;
                  allNews.push(xferNewsStory);
                  // Populate the home page stories
                  if (i === 0) {
                    gDoc.homeNewsStories.push(xferNewsStory);
                  }
                }
              }
            }

            async.timesSeries(
              allNews,
              function(story, innerCallback) {
                bcrypt.hash(story.link, 10, function(err, hash) {
                  if (err) {
                    innerCallback(err);
                  }
                  // Only add the story if it is not in there-already
                  // Stories on NYT can be shared between categories
                  story.storyID = hash
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_")
                    .replace(/=+$/, "");
                  if (
                    gDoc.newsStories.findIndex(function(o) {
                      if (
                        o.storyID === story.storyID ||
                        o.title === story.title
                      ) {
                        return true;
                      } else {
                        return false;
                      }
                    }) === -1
                  ) {
                    gDoc.newsStories.push(story);
                  }

                  innerCallback();
                });
              },
              function(err) {
                if (err) {
                  console.log("failure on story id creation");
                } else {
                  console.log("story id creation success");
                  globalNewsDoc = gDoc;
                  setImmediate(function() {
                    refreshAllUserStories();
                  });
                }
              }
            );
          }
        });
      }
    }
  );
}, 240 * 60 * 1000);

function refreshAllUserStories() {
  db.collection.findOneAndUpdate(
    { _id: globalNewsDoc._id },
    { $set: { newsStories: globalNewsDoc.newsStories } },
    function(err, result) {
      if (err) {
        console.log("FORK ERROR Replace of global newsStories failed: ", err);
      } else if (result.ok !== 1) {
        console.log("Replace of global newsStories failed:", result);
      } else {
        // For each NewsWatcher user, do news matching on their newsFilters
        var cursor = db.collection.find({ type: "USER_TYPE" });
        var keepProcessing = true;
        async.doWhilst(
          function(callback) {
            cursor.next(function(err, doc) {
              if (doc) {
                refreshStories(doc, function(err) {
                  callback(null);
                });
              } else {
                keepProcessing = false;
                callback(null);
              }
            });
          },
          function() {
            return keepProcessing;
          },
          function(err) {
            console.log("Timer: Refreshed and matched. err:", err);
          }
        );
      }
    }
  );
}
