   const { Pool } = require('pg');
   const pool = new Pool({
    user: 'postgres',         
    host: 'localhost',       
    database: 'notes',    
    password: 'abhi8767',
    port: 5432
    });

    module.exports = pool;