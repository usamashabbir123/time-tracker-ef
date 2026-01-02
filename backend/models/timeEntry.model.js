const db = require('../config/db');

async function startTime(user_id, project_id, task_name, description) {
    const startTime = new Date();

    const [result] = await db.query(
        `INSERT INTO time_entries 
         (user_id, project_id, task_name, description, start_time, end_time, total_time) 
         VALUES (?, ?, ?, ?, ?, NULL, 0)`,
        [user_id, project_id, task_name, description, startTime]
    );

    return result.insertId;
}

async function stopTime(id) {
    const [rows] = await db.query(
        'SELECT start_time FROM time_entries WHERE id = ? AND end_time IS NULL',
        [id]
    );

    if (!rows.length) {
        throw new Error('Active time entry not found');
    }

    const startTime = new Date(rows[0].start_time);
    const endTime = new Date();

    const totalTime = Math.floor((endTime - startTime) / 60000); // minutes

    await db.query(
        'UPDATE time_entries SET end_time = ?, total_time = ? WHERE id = ?',
        [endTime, totalTime, id]
    );

    return totalTime;
}

async function getAll() {
    const [rows] = await db.query(
        `SELECT t.*, p.name AS project_name, u.name AS user_name
         FROM time_entries t
         JOIN projects p ON t.project_id = p.id
         JOIN users u ON t.user_id = u.id
         ORDER BY t.start_time DESC`
    );
    return rows;
}

async function getByUser(user_id) {
    const [rows] = await db.query(
        `SELECT t.*, p.name AS project_name
         FROM time_entries t
         JOIN projects p ON t.project_id = p.id
         WHERE t.user_id = ?
         ORDER BY t.start_time DESC`,
        [user_id]
    );
    return rows;
}

async function getByManager(manager_id) {
    const [rows] = await db.query(
        `SELECT t.*, u.name AS user_name, p.name AS project_name
         FROM time_entries t
         JOIN users u ON t.user_id = u.id
         JOIN projects p ON t.project_id = p.id
         WHERE u.manager_id = ?
         ORDER BY t.start_time DESC`,
        [manager_id]
    );
    return rows;
}

async function approveEntry(id, status, manager_comment = '') {
    await db.query(
        'UPDATE time_entries SET status = ?, manager_comment = ? WHERE id = ?',
        [status, manager_comment, id]
    );
}

module.exports = {
    startTime,
    stopTime,
    getAll,
    getByUser,
    getByManager,
    approveEntry
};
