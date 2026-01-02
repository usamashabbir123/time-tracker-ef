const db = require('../config/db');

async function startTime(user_id, project_id, task_name, description) {
    const startTime = new Date();
    const [result] = await db.query(
        'INSERT INTO time_entries (user_id, project_id, task_name, description, start_time) VALUES (?, ?, ?, ?, ?)',
        [user_id, project_id, task_name, description, startTime]
    );
    return result.insertId;
}

async function stopTime(id) {
    const [entry] = await db.query('SELECT start_time FROM time_entries WHERE id = ?', [id]);
    if (!entry.length) throw new Error("Time entry not found");

    const startTime = new Date(entry[0].start_time);
    const endTime = new Date();
    const totalTime = Math.floor((endTime - startTime) / 60000);

    await db.query('UPDATE time_entries SET end_time = NOW(), total_time = ? WHERE id = ?', [totalTime, id]);
    return totalTime;
}

async function getAll() {
    const [rows] = await db.query('SELECT * FROM time_entries');
    return rows;
}

async function getByUser(user_id) {
    const [rows] = await db.query('SELECT * FROM time_entries WHERE user_id = ?', [user_id]);
    return rows;
}

async function getByManager(manager_id) {
    const [rows] = await db.query(
        'SELECT t.* FROM time_entries t JOIN users u ON t.user_id = u.id WHERE u.manager_id = ?',
        [manager_id]
    );
    return rows;
}

async function approveEntry(id, status, manager_comment = '') {
    await db.query('UPDATE time_entries SET status = ?, manager_comment = ? WHERE id = ?', [status, manager_comment, id]);
}

module.exports = { startTime, stopTime, getAll, getByUser, getByManager, approveEntry };
