require("dotenv").config();

var createError = require("http-errors");
var express = require("express");
var path = require("path");
const session = require("express-session");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

var usersRouter = require("./routes/users");
var erpRouter = require("./routes/erp");
var apiRouter = require("./routes/api");

const { goturDB, initGoturModels } = require("./utilities/goturDb"); // ortak kullanıcı & session DB
const SequelizeStore = require("connect-session-sequelize")(session.Store);
const tenantMiddleware = require("./middlewares/tenantMiddleware");
const tenantSessionMiddleware = require("./middlewares/tenantSessionMiddleware");

const { hasSubdomain } = require("./utilities/tenantConfig");

const commonModels = initGoturModels();

// session store (gotur DB üzerinde)
var store = new SequelizeStore({
  db: goturDB,
});

// session tablosunu oluştur
store.sync();

var app = express();

const isProduction = app.get("env") === "production";

if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === "anadolutat")) {
  // eslint-disable-next-line no-console
  console.error(
    "UYARI: SESSION_SECRET .env üzerinde tanımlanmamış veya varsayılan değerde. " +
    "Production ortamında güçlü, benzersiz bir SESSION_SECRET ayarlanmalı."
  );
}
const sessionSecret = process.env.SESSION_SECRET || "anadolutat";

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

if (isProduction) {
  app.set("trust proxy", 1);
}

// GÜVENLİK: helmet ile temel HTTP güvenlik başlıkları (X-Frame-Options,
// X-Content-Type-Options, HSTS vb.) ekleniyor. CSP kapalı bırakıldı çünkü
// mevcut Pug şablonları geniş çapta satır-içi <script>/<style> kullanıyor;
// varsayılan CSP tüm arayüzü kırardı. Ayrı bir görev olarak, şablonlar
// nonce/hash tabanlı CSP'ye uyumlu hale getirildikten sonra etkinleştirilebilir.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// GÜVENLİK: Brute-force login denemelerini sınırlamak için rate limit.
// routes/erp.js'deki POST /login rotasında req.app.get("loginRateLimiter")
// ile okunuyor.
app.set(
  "loginRateLimiter",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Çok fazla giriş denemesi yapıldı. Lütfen daha sonra tekrar deneyin." },
  })
);

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "node_modules")));

app.use((req, res, next) => {
  req.commonModels = commonModels;
  next();
});

// /api rotaları kendi router'ı içinde (routes/api.js) apiKeyAuth + tenantMiddleware'i
// zaten uyguluyor; burada tekrar uygulamak DB bağlantı çözümlemesinin ve API key
// doğrulamasının istek başına iki kez çalışmasına neden oluyordu.
app.use("/api", apiRouter);

// Sistem, subdomain'i olmayan (örn. "goturyzhn.com", "www.goturyzhn.com" veya
// lokalde çıplak "localhost") isteklerde artık bir tenant çözümlemeye
// çalışıp hata döndürmek yerine, sistemi tanıtan bir one-pager gösteriyor.
// Bu kontrol tenantMiddleware'den ÖNCE yapılıyor; aksi halde subdomain'i
// olmayan istekler "Tenant could not be determined." hatasına düşüyordu.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return next();
  }

  if (!hasSubdomain(req.hostname)) {
    return res.render("landing", { title: "Gotur VIP" });
  }

  next();
});

app.use(tenantMiddleware);
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: store,
    // GÜVENLİK: cookie'ler production'da secure (HTTPS-only) ve sameSite=lax
    // olarak işaretleniyor; CSRF ve HTTP üzerinden çalınma riskini azaltır.
    // Local/geliştirme ortamı HTTPS kullanmadığından secure orada kapalı
    // bırakılıyor (aksi halde session hiç kalıcı olmazdı).
    cookie: {
      maxAge: 86400000,
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
    },
  })
);

app.use(tenantSessionMiddleware);

// Web Router'ları
app.use("/users", usersRouter);
app.use("/", erpRouter);

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
