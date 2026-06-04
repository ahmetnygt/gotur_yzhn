const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    const UetdsPlace = sequelize.define(
        "uetdsplace",
        {
            uetdsProvinceCode: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            provinceName: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            uetdsDistrictCode: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            districtName: {
                type: DataTypes.STRING,
                allowNull: false,
            },
        },
        {
            timestamps: true,
            indexes: [
                {
                    fields: ["uetdsProvinceCode"],
                },
                {
                    fields: ["uetdsDistrictCode"],
                },
            ],
        }
    );

    // Ek ilişkiler tanımlanabilir (örneğin illere göre gruplayarak)
    UetdsPlace.associate = function (models) {
        // Örnek: models.UetdsPlace.belongsTo(models.OtherModel, { foreignKey: 'uetdsProvinceCode' });
    };

    return UetdsPlace;
};