const { Sequelize } = require("sequelize");
const PlaceFactory = require("../models/placeModel");
const FirmFactory = require("../models/firmModel");
const ApiKeyFactory = require("../models/apiKeyModel");
const UetdsPlaceFactory = require("../models/uetdsPlaceModel");
const TicketPaymentFactory = require("../models/ticketPaymentModel");
const placesSeedData = require("../seeders/placeSeeder.json");
const uetdsPlacesSeedData = require("../seeders/uetdsPlaceSeeder.json");

console.log((process.env.GOTUR_DB_HOST, process.env.GOTUR_DB_PORT, process.env.GOTUR_DB_NAME, process.env.GOTUR_DB_USERNAME));
const GOTUR_DB_NAME = process.env.GOTUR_DB_NAME
const GOTUR_DB_USERNAME = process.env.GOTUR_DB_USERNAME
const GOTUR_DB_PASSWORD = process.env.GOTUR_DB_PASSWORD

const goturConnectionOptions = {
    host: process.env.GOTUR_DB_HOST,
    dialect: process.env.GOTUR_DB_DIALECT || "mysql",
    logging: false,
};

if (process.env.GOTUR_DB_PORT) {
    goturConnectionOptions.port = Number(process.env.GOTUR_DB_PORT);
}

if (process.env.GOTUR_DB_TIMEZONE) {
    goturConnectionOptions.timezone = process.env.GOTUR_DB_TIMEZONE;
}

const definedEntries = Object.entries(goturConnectionOptions).filter(([, value]) => value !== undefined && value !== "");
const sanitizedOptions = Object.fromEntries(definedEntries);

const goturDB = new Sequelize(
    GOTUR_DB_NAME,
    GOTUR_DB_USERNAME,
    GOTUR_DB_PASSWORD,
    sanitizedOptions
);

const goturModels = Object.freeze({
    Firm: FirmFactory(goturDB),
    Place: PlaceFactory(goturDB),
    ApiKey: ApiKeyFactory(goturDB),
    UetdsPlace: UetdsPlaceFactory(goturDB),
    TicketPayment: TicketPaymentFactory(goturDB),
});

let goturSyncPromise;

function initGoturModels() {
    return goturModels;
}

async function getGoturSyncPromise() {
    if (!goturSyncPromise) {
        try {
            await goturDB.sync({});

            const placeCount = await goturModels.Place.count();

            if (placeCount === 0 && Array.isArray(placesSeedData) && placesSeedData.length > 0) {
                await goturModels.Place.bulkCreate(placesSeedData, { ignoreDuplicates: true });
            }

            const uetdsPlaceCount = await goturModels.UetdsPlace.count();

            if (uetdsPlaceCount === 0 && Array.isArray(uetdsPlacesSeedData) && uetdsPlacesSeedData.length > 0) {
                await goturModels.UetdsPlace.bulkCreate(uetdsPlacesSeedData, { ignoreDuplicates: true });
            }

        } catch (error) {
            console.error("Places tablosu başlangıç verileri yüklenirken hata oluştu:", error);
        }
        goturSyncPromise = goturDB.sync({}).catch((error) => {
            goturSyncPromise = null;
            throw error;
        });
    }

    return goturSyncPromise;
}

getGoturSyncPromise();

module.exports = { goturDB, initGoturModels, getGoturSyncPromise };
