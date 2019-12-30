var express = require("express");
var joi = require("joi");
var authHelper = require("./authHelper");

var router = express.Router();

router.post("/", authHelper.checkAuth, function(req, res, next) {
  // Validate the body
  var schema = {
    contentSnippet: joi
      .string()
      .max(200)
      .required(),
    date: joi.date().required(),
    hours: joi.string().max(20),
    imageUrl: joi
      .string()
      .max(300)
      .required(),
    keep: joi.bool().required(),
    link: joi
      .string()
      .max(300)
      .required(),
    source: joi
      .string()
      .max(50)
      .required(),
    storyID: joi
      .string()
      .max(100)
      .required(),
    title: joi
      .string()
      .max(200)
      .required()
  };

  joi.validate(req.body, schema, function(err) {
    if (err) {
      return next(err);
    }

    // We first make sure we not at count limit
    req.db.collection.count({ type: "SHAREDSTORY_TYPE" }, function(err, count) {
      if (err) {
        return next(err);
      }

      if (count > process.env.MAX_SHARED_STORIES) {
        return next(new Error("Shared story limit reach"));
      }

      // Make sure the story not already shared
      req.db.collection.count(
        { type: "SHAREDSTORY_TYPE", _id: req.body.storyID },
        function(err, count) {
          if (err) {
            return next(err);
          }

          if (count > 0) {
            return next(new Error("The story already shared"));
          }

          // We set the id and guarantee uniqueness or failure happens
          var xferStory = {
            _id: req.body.storyID,
            type: "SHAREDSTORY_TYPE",
            story: req.body,
            comments: [
              {
                displayName: req.auth.displayName,
                userId: req.auth.userId,
                dateTime: Date.now(),
                comment:
                  req.auth.displayName + " thought everyone might enjoy this"
              }
            ]
          };

          req.db.collection.insertOne(xferStory, function(err, result) {
            if (err) {
              return next(err);
            }

            res.status(201).json(result.ops[0]);
          });
        }
      );
    });
  });
});

router.get("/", authHelper.checkAuth, function(req, res, next) {
  req.db.collection
    .find({ type: "SHAREDSTORY_TYPE" })
    .toArray(function(err, doc) {
      if (err) {
        return next(err);
      }

      res.status(200).json(doc);
    });
});

router.delete(":/sid", function(req, res, next) {
  req.db.collection.findOneAndDelete(
    {
      type: "SHAREDSTORY_TYPE",
      _id: req.params.sid
    },
    function(err, result) {
      if (err) {
        console.log("+++POSSIBLE	CONTENTION	ERROR?+++	err:", err);
        return next(err);
      } else if (result.ok !== 1) {
        console.log("+++POSSIBLE	CONTENTION	ERROR?+++	result:", result);
        return next(new Error("Shared story was deleted failured"));
      }
      res.status(200).json({ msg: "Your shared story deleted" });
    }
  );
});

router.post("/:sid/comments", authHelper.checkAuth, function(req, res, next) {
  // Validate the body
  var schema = {
    comment: joi
      .string()
      .max(250)
      .required()
  };

  joi.validate(req.body, schema, function(err, value) {
    if (err) {
      return next(err);
    }

    var xferComment = {
      displayName: req.auth.displayName,
      userId: req.auth.userId,
      dateTime: Date.now(),
      comment: req.body.comment.substring(0, 250)
    };

    req.db.collection.findOneAndUpdate(
      {
        type: "SHAREDSTORY_TYPE",
        _id: req.params.sid
      },
      {
        $push: {
          comments: xferComment
        }
      },
      function(err, result) {
        if (result && result.value === null) {
          return next(new Error("Comment limit reached"));
        } else if (err) {
          return next(err);
        } else if (result.ok !== 1) {
          return next(new Error("Comment saved failured"));
        }

        res.status(201).json({ msg: "Comment was added" });
      }
    );
  });
});

module.exports = router;
