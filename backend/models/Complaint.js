module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  return sequelize.define('Complaint', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    siteCode: { type: DataTypes.STRING(50), allowNull: false, field: 'site_code' },
    siteName: { type: DataTypes.STRING(255), allowNull: false, field: 'site_name' },
    cat: {
      type: DataTypes.ENUM('Equipment', 'Data', 'Calibration', 'Connectivity', 'Service', 'Other'),
      defaultValue: 'Other',
    },
    msg: { type: DataTypes.TEXT, allowNull: false },
    status: {
      type: DataTypes.ENUM('open', 'progress', 'resolved'),
      defaultValue: 'open',
    },
    by: { type: DataTypes.STRING(100), defaultValue: '—' },
    time: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'complaints',
    underscored: true,
    timestamps: false,
  });
};