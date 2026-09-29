const path = require('path');

// Change working directory to backend so all relative paths, models, and .env resolve properly
process.chdir(path.join(__dirname, 'backend'));

// Start backend server
require('./server');
