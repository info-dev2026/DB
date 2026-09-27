module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  return sequelize.define('ServiceContract', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    siteCode: { type: DataTypes.STRING(50), allowNull: false, field: 'site_code' },
    key: { type: DataTypes.STRING(255), allowNull: false },
    start: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    expiry: { type: DataTypes.DATE, defaultValue: null },
    package: { type: DataTypes.STRING(100), defaultValue: null },
    suspended: { type: DataTypes.BOOLEAN, defaultValue: false },
  }, {
    tableName: 'service_contracts',
    underscored: true,
    timestamps: true,
    indexes: [{ unique: true, fields: ['site_code', 'key'] }],
  });
};