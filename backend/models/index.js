/* ============================================================
   models/index.js — registers all Sequelize models
   and defines their associations.
   ============================================================ */

const sequelize = require('../config/database');

const Site            = require('./Site')(sequelize);
const Param           = require('./Param')(sequelize);
const User            = require('./User')(sequelize);
const Alert           = require('./Alert')(sequelize);
const Complaint       = require('./Complaint')(sequelize);
const Reading         = require('./Reading')(sequelize);
const ServiceContract = require('./ServiceContract')(sequelize);
const ServiceHistory  = require('./ServiceHistory')(sequelize);
const BoardConfig     = require('./BoardConfig')(sequelize);

/* ---------- Associations ---------- */

Site.hasMany(Param, { foreignKey: 'siteCode', sourceKey: 'siteCode', as: 'params', onDelete: 'CASCADE' });
Param.belongsTo(Site, { foreignKey: 'siteCode', targetKey: 'siteCode', as: 'site' });

Site.hasMany(BoardConfig, { foreignKey: 'siteCode', sourceKey: 'siteCode', as: 'boardConfigs', onDelete: 'CASCADE' });
BoardConfig.belongsTo(Site, { foreignKey: 'siteCode', targetKey: 'siteCode', as: 'site' });

Site.hasMany(Reading, { foreignKey: 'siteCode', sourceKey: 'siteCode', as: 'readings', onDelete: 'CASCADE' });
Reading.belongsTo(Site, { foreignKey: 'siteCode', targetKey: 'siteCode', as: 'site' });

Site.hasMany(Alert, { foreignKey: 'siteCode', sourceKey: 'siteCode', as: 'alerts', onDelete: 'CASCADE' });
Alert.belongsTo(Site, { foreignKey: 'siteCode', targetKey: 'siteCode', as: 'site' });

Site.hasMany(Complaint, { foreignKey: 'siteCode', sourceKey: 'siteCode', as: 'complaints', onDelete: 'CASCADE' });
Complaint.belongsTo(Site, { foreignKey: 'siteCode', targetKey: 'siteCode', as: 'site' });

Site.hasMany(ServiceContract, { foreignKey: 'siteCode', sourceKey: 'siteCode', as: 'contracts', onDelete: 'CASCADE' });
ServiceContract.belongsTo(Site, { foreignKey: 'siteCode', targetKey: 'siteCode', as: 'site' });

ServiceContract.hasMany(ServiceHistory, { foreignKey: 'contractId', as: 'history', onDelete: 'CASCADE' });
ServiceHistory.belongsTo(ServiceContract, { foreignKey: 'contractId', as: 'contract' });

User.belongsTo(Site, { foreignKey: 'siteCode', targetKey: 'siteCode', as: 'site', constraints: false });

module.exports = {
  sequelize,
  Site,
  Param,
  User,
  Alert,
  Complaint,
  Reading,
  ServiceContract,
  ServiceHistory,
  BoardConfig,
};