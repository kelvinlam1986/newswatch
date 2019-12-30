var assert = require("assert");
var app = require("../server");
var request = require("supertest")(app);

describe("User cycle operation", function() {
  var userId;
  var token;
  var savedDoc;

  // Wait until the database up and connected to
  before(function(done) {
    setTimeout(function() {
      done();
    }, 5000);
  });

  // Shut everything down grateful
  after(function(done) {
    app.db.client.close();
    app.node2.kill();
    app.close(done);
  });

  it("should deny unregistered user a login attempt", function(done) {
    request
      .post("/api/sessions")
      .send({
        email: "abc@gmail.com",
        password: "12345678x@X"
      })
      .end(function(err, res) {
        assert.equal(res.status, 500);
        done();
      });
  });

  it("should create a new registered user", function(done) {
    request
      .post("/api/users")
      .send({
        email: "kelvincoder@gmail.com",
        displayName: "Minh Lam",
        password: "12345678x@X"
      })
      .end(function(err, res) {
        assert.equal(res.status, 201);
        assert.equal(
          res.body.displayName,
          "Minh Lam",
          "Name of user should be set"
        );
        done();
      });
  });

  it("should not create a User twice", function(done) {
    request
      .post("/api/users")
      .send({
        email: "kelvincoder@gmail.com",
        displayName: "Minh Lam",
        password: "12345678x@X"
      })
      .end(function(err, res) {
        assert.equal(res.status, 500);
        assert.equal(
          res.body.message,
          "Error: Email account already registered",
          "Error should be email account already registered"
        );
        done();
      });
  });

  it("should detect incorrect password", function(done) {
    request
      .post("/api/sessions")
      .send({
        email: "kelvincoder@gmail.com",
        password: "87654321x@X"
      })
      .end(function(err, res) {
        assert.equal(res.status, 500);
        assert.equal(
          res.body.message,
          "Error: Wrong password",
          "Error should be wrong password"
        );
        done();
      });
  });

  it("should allow registerd user to login", function(done) {
    request
      .post("/api/sessions")
      .send({
        email: "kelvincoder@gmail.com",
        password: "12345678x@X"
      })
      .end(function(err, res) {
        token = res.body.token;
        userId = res.body.userId;
        assert.equal(res.status, 201);
        assert.equal(
          res.body.msg,
          "Authorized",
          "Message should be authorized"
        );
        done();
      });
  });

  it("it should allow registered user to logout", function(done) {
    request
      .del("/api/sessions" + userId)
      .set("x-auth", token)
      .end(function(err, res) {
        assert.equal(res.status, 200);
        done();
      });
  });

  it("It should not allow to access if not logged in", function(done) {
    request.get("/api/users/" + userId).end(function(err, res) {
      assert.equal(500, res.status);
      done();
    });
  });

  it("It should allow to access if user logged in", function(done) {
    request
      .get("/api/users/" + userId)
      .set("x-auth", token)
      .end(function(err, res) {
        assert.equal(res.status, 200);
        done();
      });
  });

  it("should update the profile with new newsFilters", function(done) {
    request
      .put("/api/users/" + userId)
      .send({
        settings: {
          requireWIFI: true,
          enableAlerts: false
        },
        newsFilters: [
          {
            name: "Politics",
            keyWords: ["Obama", "Clinton", "Bush", "Trump", "Putin"],
            enableAlert: false,
            alertFrequency: 0,
            enableAutoDelete: false,
            deleteTime: 0,
            timeOfLastScan: 0
          },
          {
            name: "Countries",
            keyWords: [
              "United States",
              "China",
              "Russia",
              "Isarel",
              "India",
              "Iran"
            ],
            enableAlert: false,
            alertFrequency: 0,
            enableAutoDelete: false,
            deleteTime: 0,
            timeOfLastScan: 0
          }
        ]
      })
      .set("x-auth", token)
      .end(function(err, res) {
        assert.equal(res.status, 200);
        done();
      });
  });

  // We need the delay, as the background process will update the news stories with the changed newsFilters
  it("should return updated news stories", function(done) {
    setTimeout(function() {
      request
        .get("/api/users/" + userId)
        .set("x-auth", token)
        .end(function(err, res) {
          assert.equal(res.status, 200);
          savedDoc = res.body.newsFilters[0].newsStories[0];
          done();
        });
    }, 3000);
  });

  // POST: /api/userprofile/savestpry BODY: {"filterIdx": <idx>, "storyIdx": <idx> }
  it("should move a news story to the savedStories folder", function(done) {
    request
      .post("/api/users/" + userId + "/savedstories")
      .send(savedDoc)
      .set("x-auth", token)
      .end(function(err, res) {
        assert.equal(res.status, 200);
        done();
      });
  });

  // DELETE: /api/userprofile/savestory BODY:{"filterIdx": <idx>, "storyIdx", <idx>}
  it("should delete a news story from savedStories folder", function(done) {
    request
      .del("/api/users/" + userId + "/savedstories/" + savedDoc.storyID)
      .set("x-auth", token)
      .end(function(err, res) {
        assert.equal(res.status, 200);
        done();
      });
  });

  it("should delete a registered User", function(done) {
    request
      .del("/api/users/" + userId)
      .set("x-auth", token)
      .end(function(err, res) {
        assert.equal(res.status, 200);
        done();
      });
  });

  it("should return a 404 for invalid requests", function(done) {
    request.get("/blah").end(function(err, res) {
      assert.equal(res.status, 404);
      done();
    });
  });
});
