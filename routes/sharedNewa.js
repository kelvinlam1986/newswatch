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
      .required()
  };
});

module.exports = router;
