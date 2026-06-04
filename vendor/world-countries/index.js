const createDisplayNames = (locale) => {
  if (typeof Intl === "undefined" || typeof Intl.DisplayNames !== "function") {
    return null;
  }

  try {
    return new Intl.DisplayNames([locale], { type: "region" });
  } catch (error) {
    return null;
  }
};

const englishDisplay = createDisplayNames("en");
const turkishDisplay = createDisplayNames("tr");

const countriesMap = new Map();

if (englishDisplay) {
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first) + String.fromCharCode(second);
      let englishName;
      try {
        englishName = englishDisplay.of(code);
      } catch (error) {
        englishName = null;
      }

      if (!englishName || englishName === code) {
        continue;
      }

      let turkishName = null;
      if (turkishDisplay) {
        try {
          turkishName = turkishDisplay.of(code);
        } catch (error) {
          turkishName = null;
        }
      }

      const trimmedEnglish = typeof englishName === "string" ? englishName.trim() : "";
      const trimmedTurkish = typeof turkishName === "string" ? turkishName.trim() : "";
      const commonName = trimmedEnglish || code;
      const turkishCommon = trimmedTurkish || trimmedEnglish || code;

      countriesMap.set(code, {
        cca2: code,
        name: {
          common: commonName,
          official: commonName,
        },
        translations: {
          tur: {
            common: turkishCommon,
            official: turkishCommon,
          },
        },
        altSpellings: Array.from(new Set([commonName, turkishCommon].filter(Boolean))),
      });
    }
  }
}

if (!countriesMap.size) {
  countriesMap.set("TR", {
    cca2: "TR",
    name: {
      common: "Turkey",
      official: "Republic of Türkiye",
    },
    translations: {
      tur: {
        common: "Türkiye",
        official: "Türkiye Cumhuriyeti",
      },
    },
    altSpellings: ["Turkey", "Türkiye"],
  });
}

module.exports = Array.from(countriesMap.values()).sort((a, b) => a.cca2.localeCompare(b.cca2));
