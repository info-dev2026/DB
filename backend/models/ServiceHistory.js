module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  return sequelize.define('ServiceHistory', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    contractId: { type: DataTypes.INTEGER, allowNull: false, field: 'contract_id' },
    package: { type: DataTypes.STRING(100) },
    months: { type: DataTypes.INTEGER },
    price: { type: DataTypes.DECIMAL(15, 2) },
    at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    till: { type: DataTypes.DATE },
    by: { type: DataTypes.STRING(100) },
  }, {
    tableName: 'service_history',
    underscored: true,
    timestamps: false,
  });
};