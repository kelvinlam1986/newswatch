var express = require("express"); // process router and template
var path = require("path"); // populate the path property of request
var logger = require("morgan"); // process logger
var bodyParser = require("body-parser"); // access HTTP Body request
var responseTime = require("response-time"); // log performance time
var helmet = require("helmet"); // measure security
var RateLimit = require("express-rate-limit"); // limit based IP
var csp = require("helmet-csp");
var cp = require("child_process");
var assert = require("assert");

if (process.env.NODE_ENV != "production") {
  require("dotenv").config();
}

var users = require("./routes/users");
var session = require("./routes/session");
var sharedNews = require("./routes/sharedNews");
var homeNews = require("./routes/homeNews");

var app = express();
app.enable("trust proxy");

// Apply limits for all requests
var limiter = new RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 request per WindowMs
  delayMs: 0 // disable delaying - full speed until max limit
});

app.use(limiter);
app.use(helmet()); // Take the default for start with
app.use(
  csp({
    //	Specify	directives	for	content	sources
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "ajax.googleapis.com",
        "maxcdn.bootstrapcdn.com"
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "maxcdn.bootstrapcdn.com"],
      fontSrc: ["'self'", "maxcdn.bootstrapcdn.com"],
      imgSrc: ["*"]
    }
  })
);

// Adds	an X-Response-Time header to responses to measure response times
app.use(responseTime());

// logs	all	HTTP requests. The "dev" option	gives it a specific styling
app.use(logger("dev"));

// Sets	up the response	object in routes to	contain	a body property	with an
// object of what is parsed	from a JSON	body request payload
// There is no need for	allowing a huge	body, it might be some attack,
// so use the limit option
app.use(bodyParser.json({ limit: "100kb" }));

// Main	HTML page to be	returned is	in the build directory
app.get("/", function(req, res) {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

// Serving up of static	content such as HTML for the React
// SPA, images, CSS files, and JavaScript files
app.use(express.static(path.join(__dirname, "build")));

// If the forked process is experiencing runtime errors, it could shut itself down
// and then the main process could be signaled to start	it up again
var node2 = cp.fork("./worker/app_FORK.js");
node2.on("exit", function(code) {
  node2 = undefined;
  node2 = cp.fork("./worker/app_FORK.js");
});

var db = {};
var MongoClient = require("mongodb").MongoClient;

// Use connect method to connect to the Server
MongoClient.connect(process.env.MONGODB_CONNECT_URL, function(err, client) {
  // if error != null then terminate program
  assert(err, null);
  db.client = client;
  db.collection = client.db("newswatcherdb").collection("newswatcher");
});

app.use(function(req, res, next) {
  req.db = db;
  req.node2 = node2;
  next();
});

// REST API routes
app.use("/api/users", users);
app.use("/api/sessions", session);
app.use("/api/sharednews", sharedNews);
app.use("/api/homenews", homeNews);

// catch everything	else and forward to	error handler as a 404 to return
app.use(function(req, res, next) {
  var err = new Error("Not found");
  err.status = 404;
  next(err);
});

// development error handler that will add in a stacktrace
if (app.get("env") === "development") {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500).json({ message: err.toString(), error: err });
    console.log(err);
  });
} else {
  // production error handler with no stacktraces exposed to users
  app.use(function(err, req, res, next) {
    res.status(err.status || 500).json({ message: err.toString(), error: {} });
    console.log(err);
  });
}

app.set("port", process.env.port || 5000);
var server = app.listen(app.get("port"), function() {
  console.log("Server is listening on port: " + server.address().port);
});

server.db = db;
server.node2 = node2;

module.exports = server;
