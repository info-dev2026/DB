module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  return sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    role: {
      type: DataTypes.ENUM('admin', 'engineer', 'sales', 'industry'),
      allowNull: false,
    },
    login: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false, field: 'password_hash' },
    mobile: { type: DataTypes.STRING(50), defaultValue: '' },
    email: { type: DataTypes.STRING(255), defaultValue: '' },
    siteCode: { type: DataTypes.STRING(50), defaultValue: null, field: 'site_code' },
  }, {
    tableName: 'users',
    underscored: true,
    timestamps: true,
  });
};