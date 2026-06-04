require("dotenv").config();

var createError = require("http-errors");
var express = require("express");
var path = require("path");
const session = require("express-session");
var cookieParser = require("cookie-parser");
var logger = require("morgan");

var usersRouter = require("./routes/users");
var erpRouter = require("./routes/erp");
var apiRouter = require("./routes/api");

const { goturDB, initGoturModels } = require("./utilities/goturDb"); // ortak kullanıcı & session DB
const SequelizeStore = require("connect-session-sequelize")(session.Store);
const tenantMiddleware = require("./middlewares/tenantMiddleware");
const tenantSessionMiddleware = require("./middlewares/tenantSessionMiddleware");

const commonModels = initGoturModels();

// session store (gotur DB üzerinde)
var store = new SequelizeStore({
  db: goturDB,
});

// session tablosunu oluştur
store.sync();

var app = express();

const sessionSecret = process.env.SESSION_SECRET || "anadolutat";

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "node_modules")));

// session middleware
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
      maxAge: 86400000, // 1 gün
    },
  })
);

// tenant middleware (subdomain -> tenant DB)
app.use(tenantMiddleware);

// tenant bazlı session bilgisi
app.use(tenantSessionMiddleware);

// ortak modelleri (gotur DB) request içine ekle
app.use((req, res, next) => {
  req.commonModels = commonModels; // Place vs.
  next();
});

// routerlar
app.use("/users", usersRouter);
app.use("/", erpRouter);
app.use("/api", apiRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
