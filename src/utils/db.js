import * as duckdb from '@duckdb/duckdb-wasm';

let db = null;
let conn = null;

export async function initDB() {
    if (db) return { db, conn };

    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    
    const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );

    const worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    conn = await db.connect();

    await conn.query(`
        CREATE TABLE IF NOT EXISTS results (
            id VARCHAR,
            date VARCHAR,
            elevation DOUBLE,
            qcode VARCHAR,
            color VARCHAR,
            PRIMARY KEY (id, date, elevation)
        )
    `);

    return { db, conn };
}

export async function getCachedResults(ids, date, elevation) {
    if (!conn) await initDB();
    const dateStr = date.toISOString().split('T')[0];
    
    // Split into chunks if too many ids to avoid SQL length limits
    const chunkSize = 500;
    let allResults = [];
    
    for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const idsStr = chunk.map(id => `'${id}'`).join(',');
        
        const result = await conn.query(`
            SELECT * FROM results 
            WHERE id IN (${idsStr}) 
            AND date = '${dateStr}' 
            AND elevation = ${elevation}
        `);
        
        allResults = allResults.concat(result.toArray().map(row => ({
            id: row.id,
            qcode: row.qcode,
            color: row.color
        })));
    }
    
    return allResults;
}

export async function cacheResults(results, date, elevation) {
    if (!conn) await initDB();
    const dateStr = date.toISOString().split('T')[0];
    
    // Use a batch insert for better performance
    if (results.length === 0) return;
    
    // Create a temporary table or use multiple values
    const values = results.map(res => 
        `('${res.id}', '${dateStr}', ${elevation}, '${res.qcode}', '${res.color}')`
    ).join(',');
    
    await conn.query(`
        INSERT OR IGNORE INTO results (id, date, elevation, qcode, color)
        VALUES ${values}
    `);
}
