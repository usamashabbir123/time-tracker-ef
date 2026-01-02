const db = require('../config/db');
const Notification = require('../models/notification.model');

// Helper function to log project history
async function logProjectHistory(projectId, action, fieldName, oldValue, newValue, userId, userName, userEmail) {
  try {
    await db.query(`
      INSERT INTO project_history (project_id, action, field_name, old_value, new_value, changed_by, changed_by_name, changed_by_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [projectId, action, fieldName, oldValue ? String(oldValue) : null, newValue ? String(newValue) : null, userId, userName, userEmail]);
  } catch (error) {
    console.error('Error logging project history:', error);
    // Don't throw - history logging failure shouldn't break the main operation
  }
}

// Get all projects - VIEW (All roles see all projects)
async function getAllProjects(req, res) {
  try {
    const userRole = req.user.role?.toLowerCase();
    const userId = req.user.id;
    
    let query = `
      SELECT DISTINCT p.*, 
             u.email as manager_email,
             u.name as manager_name,
             hmp.head_manager_id as selected_by_head_manager_id,
             hm.email as selected_by_head_manager_email,
             c.name as customer_name
      FROM projects p 
      LEFT JOIN users u ON p.manager_id = u.id 
      LEFT JOIN head_manager_projects hmp ON p.id = hmp.project_id
      LEFT JOIN users hm ON hmp.head_manager_id = hm.id
      LEFT JOIN customers c ON p.id = c.id
    `;
    
    let params = [];
    
    // All roles (admin, manager, head manager, employee) see all projects
    // No filtering needed
    
    query += ` ORDER BY p.id DESC`;
    
    const [rows] = await db.query(query, params);
    // Ensure custom_fields is properly parsed from JSON if needed
    const formattedRows = rows.map((row) => {
      if (row.custom_fields && typeof row.custom_fields === 'string') {
        try {
          row.custom_fields = JSON.parse(row.custom_fields);
        } catch (e) {
          console.error('Error parsing custom_fields for project', row.id, e);
          row.custom_fields = null;
        }
      }
      return row;
    });
    res.json(formattedRows);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch projects' });
  }
}

// Create project - CREATE (Admin, Manager, Employee, Head Manager can create projects)
async function createProject(req, res) {
  try {
    // Admin, Manager, Employee, and Head Manager can create projects
    const userRole = req.user.role?.toLowerCase();
    if (!['admin', 'manager', 'employee', 'head manager'].includes(userRole)) {
      return res.status(403).json({ success: false, message: 'Access denied. Only admins, managers, employees, and head managers can create projects.' });
    }

    const { name, description, start_date, end_date, custom_fields, status, archived, customer_id, region, allocated_time, attachment } = req.body;
    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Project name is required' });
    }
    if (!description || description.trim() === '') {
      return res.status(400).json({ success: false, message: 'Description is required' });
    }
    // Get creator name
    const [creatorRows] = await db.query('SELECT name FROM users WHERE id = ?', [req.user.id]);
    const creatorName = creatorRows.length > 0 ? creatorRows[0].name : 'User';
    const creatorRole = req.user.role?.toLowerCase();
    
    // Prepare custom_fields as JSON
    let customFieldsJson = null;
    if (custom_fields && typeof custom_fields === 'object' && Object.keys(custom_fields).length > 0) {
      customFieldsJson = JSON.stringify(custom_fields);
    }
    
    const projectStatus = status || 'on-track'; // Default to 'on-track' if not provided
    const isArchived = archived ? 1 : 0; // Convert to TINYINT
    // Normalize customer_id: convert null, undefined, empty string, or string "null" to null
    const normalizedCustomerId = (customer_id === null || customer_id === undefined || customer_id === '' || customer_id === 'null') ? null : (typeof customer_id === 'string' ? parseInt(customer_id) : customer_id);
    // Get region from customer if not provided directly
    let projectRegion = region || null;
    if (!projectRegion && normalizedCustomerId) {
      const [customerRows] = await db.query('SELECT region FROM customers WHERE id = ?', [normalizedCustomerId]);
      if (customerRows.length > 0 && customerRows[0].region) {
        projectRegion = customerRows[0].region;
      }
    }
    
    const [result] = await db.query('INSERT INTO projects (name, description, start_date, end_date, custom_fields, status, archived, customer_id, region, allocated_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [name.trim(), description.trim(), start_date || null, end_date || null, customFieldsJson, projectStatus, isArchived, normalizedCustomerId, projectRegion, allocated_time || null]);
    
    const projectId = result.insertId;
    
    // If project is created by a head manager, automatically select it for them
    if (creatorRole === 'head manager') {
      try {
        // Check if project is already selected by another head manager
        const [existingRows] = await db.query('SELECT * FROM head_manager_projects WHERE project_id = ?', [projectId]);
        if (existingRows.length === 0) {
          // Auto-select the project for the head manager who created it
          await db.query('INSERT INTO head_manager_projects (head_manager_id, project_id) VALUES (?, ?)', [req.user.id, projectId]);
          console.log(`Auto-selected project ${projectId} for head manager ${req.user.id}`);
        }
      } catch (selectError) {
        console.error('Error auto-selecting project for head manager:', selectError);
        // Don't fail the request if auto-selection fails
      }
    }
    
    // Update customer's project_name when a project is created with a customer
    if (normalizedCustomerId) {
      try {
        await db.query('UPDATE customers SET project_name = ? WHERE id = ?', [name.trim(), normalizedCustomerId]);
        console.log(`Updated customer ${normalizedCustomerId} project_name to "${name}"`);
      } catch (customerUpdateError) {
        console.error('Error updating customer project_name:', customerUpdateError);
        // Don't fail the project creation if customer update fails
      }
    }
    
    // Notify admin, manager, and head manager if project is created by an employee
    if (creatorRole === 'employee') {
      try {
        const projectMessage = `Employee ${creatorEmail} has created a new project "${name}"`;
        
        // Notify all admins
        await Notification.notifyAllAdmins(projectMessage, 'project_created');
        console.log(`Project creation notification sent to admins: ${projectMessage}`);
        
        // Notify all managers
        await Notification.notifyAllManagers(projectMessage, 'project_created');
        console.log(`Project creation notification sent to managers: ${projectMessage}`);
        
        // Notify all head managers
        await Notification.notifyAllHeadManagers(projectMessage, 'project_created');
        console.log(`Project creation notification sent to head managers: ${projectMessage}`);
      } catch (notifError) {
        console.error('Error sending notifications for employee project creation:', notifError);
        // Don't fail the request if notification creation fails
      }
    } else {
      // For non-employees, notify all admins (existing behavior)
      try {
        const adminMessage = `New project "${name}" has been created by ${creatorEmail}`;
        await Notification.notifyAllAdmins(adminMessage, 'project_created');
        console.log(`Admin notification sent: ${adminMessage}`);
      } catch (notifError) {
        console.error('Error sending admin notification for project creation:', notifError);
        // Don't fail the request if notification creation fails
      }
    }
    
    res.json({ success: true, message: 'Project created successfully', project: { id: result.insertId, name, description, start_date, end_date } });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ success: false, message: 'Failed to create project' });
  }
}

// Update project - UPDATE
async function updateProject(req, res) {
  try {
    const { id } = req.params;
    const { name, description, start_date, end_date, manager_id, status, custom_fields, archived, customer_id, region, allocated_time, attachment } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Project name is required' });
    }
    
    // Get current project to check previous manager_id and archived status
    const [projectRows] = await db.query('SELECT * FROM projects WHERE id = ?', [id]);
    if (projectRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    
    const project = projectRows[0];
    const previousManagerId = project.manager_id; // Store previous manager ID before update
    const previousArchivedStatus = project.archived; // Store previous archived status
    
    // Normalize manager_id: convert null, undefined, empty string, or string "null" to null
    const normalizedManagerId = (manager_id === null || manager_id === undefined || manager_id === '' || manager_id === 'null') ? null : manager_id;
    
    // If manager_id is provided (not null), verify it's a manager
    if (normalizedManagerId) {
      const [managerRows] = await db.query('SELECT * FROM users WHERE id = ? AND role = ?', [normalizedManagerId, 'manager']);
      if (managerRows.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid manager ID. User must be a manager.' });
      }
    }
    
    // Prepare custom_fields as JSON
    let customFieldsJson = null;
    if (custom_fields && typeof custom_fields === 'object' && Object.keys(custom_fields).length > 0) {
      customFieldsJson = JSON.stringify(custom_fields);
    }
    
    // Normalize customer_id: convert null, undefined, empty string, or string "null" to null
    const normalizedCustomerId = (customer_id === null || customer_id === undefined || customer_id === '' || customer_id === 'null') ? null : (typeof customer_id === 'string' ? parseInt(customer_id) : customer_id);
    
    // Get region from customer if not provided directly and customer_id is set
    let projectRegion = region || null;
    if (!projectRegion && normalizedCustomerId) {
      const [customerRows] = await db.query('SELECT region FROM customers WHERE id = ?', [normalizedCustomerId]);
      if (customerRows.length > 0 && customerRows[0].region) {
        projectRegion = customerRows[0].region;
      }
    }
    
    // Update project (include status and archived if provided)
    const updateFields = ['name', 'description', 'start_date', 'end_date', 'manager_id', 'custom_fields', 'customer_id', 'region', 'allocated_time', 'attachment'];
    const updateValues = [name, description, start_date || null, end_date || null, normalizedManagerId, customFieldsJson, normalizedCustomerId, projectRegion, allocated_time || null, attachment || null];
    
    if (status !== undefined) {
      updateFields.push('status');
      updateValues.push(status);
    }
    
    if (archived !== undefined) {
      updateFields.push('archived');
      updateValues.push(archived ? 1 : 0); // Convert to TINYINT
    }
    
    updateValues.push(id);
    const updateQuery = `UPDATE projects SET ${updateFields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`;
    await db.query(updateQuery, updateValues);
    
    // Log project history for changed fields
    const [userRows] = await db.query('SELECT name, email FROM users WHERE id = ?', [req.user.id]);
    const userName = userRows.length > 0 ? userRows[0].name : 'Unknown User';
    const userEmail = userRows.length > 0 ? userRows[0].email : '';
    
    // Track changes for each field
    const fieldsToTrack = {
      name: { old: project.name, new: name },
      description: { old: project.description, new: description },
      start_date: { old: project.start_date, new: start_date || null },
      end_date: { old: project.end_date, new: end_date || null },
      manager_id: { old: project.manager_id, new: normalizedManagerId },
      status: { old: project.status, new: status },
      archived: { old: project.archived ? true : false, new: archived !== undefined ? archived : (project.archived ? true : false) },
      customer_id: { old: project.customer_id, new: normalizedCustomerId },
      region: { old: project.region, new: projectRegion },
      allocated_time: { old: project.allocated_time, new: allocated_time || null },
      attachment: { old: project.attachment, new: attachment || null }
    };
    
    for (const [field, values] of Object.entries(fieldsToTrack)) {
      if (values.old !== values.new) {
        await logProjectHistory(id, 'update', field, values.old, values.new, req.user.id, userName, userEmail);
      }
    }
    
    // Archive/unarchive all tasks when project is archived/unarchived
    if (archived !== undefined) {
      try {
        const newArchivedStatus = archived ? 1 : 0;
        const oldArchivedStatus = previousArchivedStatus ? 1 : 0;
        
        // Only update tasks if the archived status is actually changing
        if (oldArchivedStatus !== newArchivedStatus) {
          // Ensure archived column exists in tasks table (add if it doesn't)
          try {
            // Check if column exists first
            const [columnCheck] = await db.query(`
              SELECT COUNT(*) as count 
              FROM INFORMATION_SCHEMA.COLUMNS 
              WHERE TABLE_SCHEMA = DATABASE() 
              AND TABLE_NAME = 'tasks' 
              AND COLUMN_NAME = 'archived'
            `);
            
            if (columnCheck.length === 0 || columnCheck[0].count === 0) {
              // Column doesn't exist, add it
              await db.query('ALTER TABLE tasks ADD COLUMN archived TINYINT(1) DEFAULT 0');
              console.log('✅ Added archived column to tasks table');
              
              // Set default value for existing tasks
              await db.query('UPDATE tasks SET archived = 0 WHERE archived IS NULL');
            }
          } catch (alterError) {
            // Column might already exist, which is fine - continue with update
            if (alterError.code !== 'ER_DUP_FIELDNAME') {
              console.warn('Warning: Could not ensure archived column exists:', alterError.message);
            }
          }
          
          // Update all tasks for this project
          const [updateResult] = await db.query('UPDATE tasks SET archived = ? WHERE project_id = ?', [newArchivedStatus, id]);
          console.log(`✅ Updated archived status for ${updateResult.affectedRows} task(s) in project ${id} to ${newArchivedStatus} (${archived ? 'archived' : 'unarchived'})`);
          
          // Verify the update worked
          if (updateResult.affectedRows > 0) {
            console.log(`✅ Successfully ${archived ? 'archived' : 'unarchived'} ${updateResult.affectedRows} task(s) for project ${id}`);
          } else {
            console.log(`ℹ️ No tasks found to update for project ${id} (project may have no tasks)`);
          }
        } else {
          console.log(`ℹ️ Project ${id} archived status unchanged (${archived ? 'archived' : 'unarchived'}), skipping task update`);
        }
      } catch (taskArchiveError) {
        console.error('❌ Error archiving/unarchiving tasks:', taskArchiveError);
        console.error('Error details:', {
          message: taskArchiveError.message,
          code: taskArchiveError.code,
          sqlState: taskArchiveError.sqlState,
          projectId: id,
          archivedValue: archived
        });
        // Don't fail the project update if task archive update fails, but log the error
      }
    }
    
    // Update customer's project_name when a project is updated with a customer
    if (normalizedCustomerId) {
      try {
        await db.query('UPDATE customers SET project_name = ? WHERE id = ?', [name.trim(), normalizedCustomerId]);
        console.log(`Updated customer ${normalizedCustomerId} project_name to "${name}"`);
      } catch (customerUpdateError) {
        console.error('Error updating customer project_name:', customerUpdateError);
        // Don't fail the project update if customer update fails
      }
    } else if (project.customer_id) {
      // If customer_id is being removed, clear the project_name from the previous customer
      try {
        await db.query('UPDATE customers SET project_name = NULL WHERE id = ?', [project.customer_id]);
        console.log(`Cleared project_name from customer ${project.customer_id}`);
      } catch (customerUpdateError) {
        console.error('Error clearing customer project_name:', customerUpdateError);
        // Don't fail the project update if customer update fails
      }
    }
    
    // Get admin name
    const [adminRows] = await db.query('SELECT name FROM users WHERE id = ?', [req.user.id]);
    const adminName = adminRows.length > 0 ? adminRows[0].name : 'Admin';
    
    // If a manager is being removed or replaced, notify the previous manager
    if (previousManagerId && previousManagerId !== normalizedManagerId) {
      const notificationMessage = `You have been removed from project "${name}" by ${adminName}`;
      
      try {
        console.log(`Creating removal notification for manager ${previousManagerId}: ${notificationMessage}`);
        const notificationId = await Notification.createNotification(previousManagerId, notificationMessage, 'project_removal');
        console.log(`Removal notification created successfully with ID: ${notificationId}`);
      } catch (notifError) {
        console.error('Error creating removal notification:', notifError);
        // Don't fail the request if notification creation fails
      }
      
      // Notify all admins about manager removal
      try {
        const [managerRows] = await db.query('SELECT name FROM users WHERE id = ?', [previousManagerId]);
        const managerName = managerRows.length > 0 ? managerRows[0].name : 'Unknown';
        const adminMessage = `Manager ${managerName} has been removed from project "${name}" by ${adminName}`;
        await Notification.notifyAllAdmins(adminMessage, 'project_manager_removed');
        console.log(`Admin notification sent: ${adminMessage}`);
      } catch (notifError) {
        console.error('Error sending admin notification for manager removal:', notifError);
      }
    }
    
    // If a manager is assigned (and it's different from previous), create a notification for the new manager
    if (normalizedManagerId && normalizedManagerId !== previousManagerId) {
      const notificationMessage = `You have been assigned to project "${name}" by ${adminName}`;
      
      try {
        console.log(`Creating notification for manager ${normalizedManagerId}: ${notificationMessage}`);
        const notificationId = await Notification.createNotification(normalizedManagerId, notificationMessage, 'project_assignment');
        console.log(`Notification created successfully with ID: ${notificationId}`);
      } catch (notifError) {
        console.error('Error creating notification:', notifError);
        // Don't fail the request if notification creation fails
      }
      
      // Notify all employees under this manager about the project assignment
      try {
        const [employeeRows] = await db.query(
          "SELECT id, email FROM users WHERE manager_id = ? AND LOWER(role) = 'employee'",
          [normalizedManagerId]
        );
        
        if (employeeRows.length > 0) {
          const [managerRows] = await db.query('SELECT name FROM users WHERE id = ?', [normalizedManagerId]);
          const managerName = managerRows.length > 0 ? managerRows[0].name : 'Your Manager';
          
          for (const employee of employeeRows) {
            try {
              const employeeNotificationMessage = `Your manager ${managerName} has been assigned to project "${name}". You can now view and work on tasks for this project.`;
              await Notification.createNotification(employee.id, employeeNotificationMessage, 'project_assignment');
              console.log(`Project assignment notification sent to employee ${employee.id} (${employee.email}): ${employeeNotificationMessage}`);
            } catch (empNotifError) {
              console.error(`Error sending notification to employee ${employee.id}:`, empNotifError);
              // Continue with other employees even if one fails
            }
          }
        }
      } catch (empNotifError) {
        console.error('Error notifying employees about project assignment:', empNotifError);
        // Don't fail the request if notification creation fails
      }
      
      // Notify all admins about manager assignment
      try {
        const [managerRows] = await db.query('SELECT email FROM users WHERE id = ?', [normalizedManagerId]);
        const managerEmail = managerRows.length > 0 ? managerRows[0].email : 'Unknown';
        const adminMessage = `Manager ${managerEmail} has been assigned to project "${name}" by ${adminEmail}`;
        await Notification.notifyAllAdmins(adminMessage, 'project_manager_assigned');
        console.log(`Admin notification sent: ${adminMessage}`);
      } catch (notifError) {
        console.error('Error sending admin notification for manager assignment:', notifError);
      }
    }
    
    // Notify admin, manager, and head manager if project is updated by an employee
    const userRole = req.user.role?.toLowerCase();
    if (userRole === 'employee') {
      try {
        const employeeId = req.user.id;
        // Get updater name
        const [updaterRows] = await db.query('SELECT name FROM users WHERE id = ?', [employeeId]);
        const updaterName = updaterRows.length > 0 ? updaterRows[0].name : 'Employee';
        const projectName = name;
        
        // Get employee's manager_id from database
        const [employeeRows] = await db.query('SELECT manager_id FROM users WHERE id = ?', [employeeId]);
        const managerId = employeeRows.length > 0 && employeeRows[0].manager_id ? employeeRows[0].manager_id : null;
        
        // Check what changed
        const nameChanged = project.name !== name;
        const descriptionChanged = project.description !== description;
        const startDateChanged = project.start_date !== (start_date || null);
        const endDateChanged = project.end_date !== (end_date || null);
        
        let updateMessage = '';
        if (nameChanged && descriptionChanged) {
          updateMessage = `Employee ${updaterEmail} has updated project "${projectName}" (name and description changed)`;
        } else if (nameChanged) {
          updateMessage = `Employee ${updaterEmail} has updated project name from "${project.name}" to "${projectName}"`;
        } else if (descriptionChanged) {
          updateMessage = `Employee ${updaterEmail} has updated project "${projectName}" description`;
        } else if (startDateChanged || endDateChanged) {
          updateMessage = `Employee ${updaterEmail} has updated project "${projectName}" dates`;
        } else {
          updateMessage = `Employee ${updaterEmail} has updated project "${projectName}"`;
        }
        
        if (updateMessage) {
          // Notify all admins
          await Notification.notifyAllAdmins(updateMessage, 'project_updated');
          console.log(`Project update notification sent to admins: ${updateMessage}`);
          
          // Notify employee's specific manager if they have one
          if (managerId) {
            try {
              await Notification.createNotification(managerId, updateMessage, 'project_updated');
              console.log(`Project update notification sent to employee's manager (ID: ${managerId}): ${updateMessage}`);
              
              // Notify head managers for this manager
              await Notification.notifyHeadManagersForManager(managerId, updateMessage, 'project_updated');
              console.log(`Project update notification sent to head managers for manager ${managerId}: ${updateMessage}`);
            } catch (managerNotifError) {
              console.error('Error sending notification to employee\'s manager:', managerNotifError);
            }
          }
        }
      } catch (notifError) {
        console.error('Error sending notifications for employee project update:', notifError);
        // Don't fail the request if notification creation fails
      }
    }
    
    res.json({ success: true, message: 'Project updated successfully' });
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ success: false, message: 'Failed to update project' });
  }
}

// Delete project - DELETE
async function deleteProject(req, res) {
  try {
    const { id } = req.params;
    
    // Get project details before deletion (including customer_id)
    const [projectRows] = await db.query('SELECT name, customer_id FROM projects WHERE id = ?', [id]);
    if (projectRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    
    const project = projectRows[0];
    const projectName = project.name || 'Unknown Project';
    const customerId = project.customer_id;
    
    // Get deleter name
    const [deleterRows] = await db.query('SELECT name, email FROM users WHERE id = ?', [req.user.id]);
    const deleterName = deleterRows.length > 0 ? deleterRows[0].name : 'User';
    const deleterEmail = deleterRows.length > 0 ? deleterRows[0].email : '';
    
    // Log project deletion in history before deleting
    await logProjectHistory(id, 'delete', null, projectName, null, req.user.id, deleterName, deleterEmail);
    
    // Delete the project
    await db.query('DELETE FROM projects WHERE id = ?', [id]);
    
    // Clear customer's project_name when a project is deleted
    if (customerId) {
      try {
        await db.query('UPDATE customers SET project_name = NULL WHERE id = ?', [customerId]);
        console.log(`Cleared project_name from customer ${customerId} after project deletion`);
      } catch (customerUpdateError) {
        console.error('Error clearing customer project_name:', customerUpdateError);
        // Don't fail the project deletion if customer update fails
      }
    }
    
    // Notify all admins about project deletion
    try {
      const adminMessage = `Project "${projectName}" has been deleted by ${deleterEmail}`;
      await Notification.notifyAllAdmins(adminMessage, 'project_deleted');
      console.log(`Admin notification sent: ${adminMessage}`);
    } catch (notifError) {
      console.error('Error sending admin notification for project deletion:', notifError);
      // Don't fail the request if notification creation fails
    }
    
    res.json({ success: true, message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ success: false, message: 'Failed to delete project' });
  }
}

// Assign manager to project - Head Manager only
async function assignManagerToProject(req, res) {
  try {
    const { id } = req.params;
    const { manager_id } = req.body;
    
    // Check if user is head manager or admin
    const userRole = req.user.role?.toLowerCase();
    if (userRole !== 'head manager' && userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Only head managers and admins can assign managers to projects.' });
    }

    // Check if project exists
    const [projectRows] = await db.query('SELECT * FROM projects WHERE id = ?', [id]);
    if (projectRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const project = projectRows[0];
    const previousManagerId = project.manager_id; // Store previous manager ID before update

    // Normalize manager_id: convert null, undefined, empty string, or string "null" to null
    const normalizedManagerId = (manager_id === null || manager_id === undefined || manager_id === '' || manager_id === 'null') ? null : manager_id;

    // If manager_id is provided (not null), verify it's a manager
    if (normalizedManagerId) {
      const [managerRows] = await db.query('SELECT * FROM users WHERE id = ? AND role = ?', [normalizedManagerId, 'manager']);
      if (managerRows.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid manager ID. User must be a manager.' });
      }
    }

    // Update project with manager assignment
    await db.query('UPDATE projects SET manager_id = ? WHERE id = ?', [normalizedManagerId, id]);
    
    // Get head manager name
    const [headManagerRows] = await db.query('SELECT name FROM users WHERE id = ?', [req.user.id]);
    const headManagerName = headManagerRows.length > 0 ? headManagerRows[0].name : 'Head Manager';
    
    // If a manager is being removed or replaced, notify the previous manager
    if (previousManagerId && previousManagerId !== normalizedManagerId) {
      const notificationMessage = `You have been removed from project "${project.name}" by ${headManagerName}`;
      
      try {
        console.log(`Creating removal notification for manager ${previousManagerId}: ${notificationMessage}`);
        const notificationId = await Notification.createNotification(previousManagerId, notificationMessage, 'project_removal');
        console.log(`Removal notification created successfully with ID: ${notificationId}`);
      } catch (notifError) {
        console.error('Error creating removal notification:', notifError);
        console.error('Notification error details:', JSON.stringify(notifError, null, 2));
        // Don't fail the request if notification creation fails
      }
      
      // Notify all admins about manager removal
      try {
        const [managerRows] = await db.query('SELECT name FROM users WHERE id = ?', [previousManagerId]);
        const managerName = managerRows.length > 0 ? managerRows[0].name : 'Unknown';
        const adminMessage = `Manager ${managerName} has been removed from project "${project.name}" by Head Manager ${headManagerName}`;
        await Notification.notifyAllAdmins(adminMessage, 'project_manager_removed');
        console.log(`Admin notification sent: ${adminMessage}`);
      } catch (notifError) {
        console.error('Error sending admin notification for manager removal:', notifError);
      }
    }
    
    // If a manager is assigned (and it's different from previous), create a notification for the new manager
    if (normalizedManagerId && normalizedManagerId !== previousManagerId) {
      const notificationMessage = `You have been assigned to project "${project.name}" by ${headManagerName}`;
      
      try {
        console.log(`Creating notification for manager ${normalizedManagerId}: ${notificationMessage}`);
        const notificationId = await Notification.createNotification(normalizedManagerId, notificationMessage, 'project_assignment');
        console.log(`Notification created successfully with ID: ${notificationId}`);
      } catch (notifError) {
        console.error('Error creating notification:', notifError);
        console.error('Notification error details:', JSON.stringify(notifError, null, 2));
        // Don't fail the request if notification creation fails
      }
      
      // Notify all employees under this manager about the project assignment
      try {
        const [employeeRows] = await db.query(
          "SELECT id, email FROM users WHERE manager_id = ? AND LOWER(role) = 'employee'",
          [normalizedManagerId]
        );
        
        if (employeeRows.length > 0) {
          const [managerRows] = await db.query('SELECT name FROM users WHERE id = ?', [normalizedManagerId]);
          const managerName = managerRows.length > 0 ? managerRows[0].name : 'Your Manager';
          
          for (const employee of employeeRows) {
            try {
              const employeeNotificationMessage = `Your manager ${managerName} has been assigned to project "${project.name}". You can now view and work on tasks for this project.`;
              await Notification.createNotification(employee.id, employeeNotificationMessage, 'project_assignment');
              console.log(`Project assignment notification sent to employee ${employee.id} (${employee.email}): ${employeeNotificationMessage}`);
            } catch (empNotifError) {
              console.error(`Error sending notification to employee ${employee.id}:`, empNotifError);
              // Continue with other employees even if one fails
            }
          }
        }
      } catch (empNotifError) {
        console.error('Error notifying employees about project assignment:', empNotifError);
        // Don't fail the request if notification creation fails
      }
      
      // Notify all admins about manager assignment
      try {
        const [managerRows] = await db.query('SELECT email FROM users WHERE id = ?', [normalizedManagerId]);
        const managerEmail = managerRows.length > 0 ? managerRows[0].email : 'Unknown';
        const adminMessage = `Manager ${managerEmail} has been assigned to project "${project.name}" by Head Manager ${headManagerEmail}`;
        await Notification.notifyAllAdmins(adminMessage, 'project_manager_assigned');
        console.log(`Admin notification sent: ${adminMessage}`);
      } catch (notifError) {
        console.error('Error sending admin notification for manager assignment:', notifError);
      }
    }
    
    res.json({ success: true, message: 'Manager assigned to project successfully' });
  } catch (error) {
    console.error('Error assigning manager to project:', error);
    res.status(500).json({ success: false, message: 'Failed to assign manager to project' });
  }
}

// Select project by head manager - only one head manager can select a project
async function selectProject(req, res) {
  try {
    const { id } = req.params; // project id
    const headManagerId = req.user.id;
    const userRole = req.user.role?.toLowerCase();

    // Check if user is head manager
    if (userRole !== 'head manager') {
      return res.status(403).json({ success: false, message: 'Access denied. Only head managers can select projects.' });
    }

    // Check if project exists
    const [projectRows] = await db.query('SELECT * FROM projects WHERE id = ?', [id]);
    if (projectRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Check if project is already selected by another head manager
    const [existingRows] = await db.query('SELECT * FROM head_manager_projects WHERE project_id = ?', [id]);
    if (existingRows.length > 0) {
      const existingHeadManagerId = existingRows[0].head_manager_id;
      
      // If it's the same head manager, allow deselection (toggle off)
      if (existingHeadManagerId === headManagerId) {
        await db.query('DELETE FROM head_manager_projects WHERE project_id = ? AND head_manager_id = ?', [id, headManagerId]);
        
        // Notify all admins about project deselection
        try {
          // Get head manager name
          const [headManagerNameRows] = await db.query('SELECT name FROM users WHERE id = ?', [headManagerId]);
          const headManagerName = headManagerNameRows.length > 0 ? headManagerNameRows[0].name : 'Head Manager';
          const project = projectRows[0];
          const adminMessage = `Head Manager ${headManagerName} has deselected project "${project.name}"`;
          await Notification.notifyAllAdmins(adminMessage, 'project_deselected');
          console.log(`Admin notification sent: ${adminMessage}`);
        } catch (notifError) {
          console.error('Error sending admin notification for project deselection:', notifError);
          // Don't fail the request if notification creation fails
        }
        
        return res.json({ success: true, message: 'Project deselected successfully', selected: false });
      } else {
        // Get the head manager's email who selected it
        const [headManagerRows] = await db.query('SELECT name FROM users WHERE id = ?', [existingHeadManagerId]);
        const headManagerName = headManagerRows.length > 0 ? headManagerRows[0].name : 'Another head manager';
        return res.status(400).json({ 
          success: false, 
          message: 'This project already Selected',
          selectedBy: headManagerName
        });
      }
    }

    // Select the project
    await db.query('INSERT INTO head_manager_projects (head_manager_id, project_id) VALUES (?, ?)', [headManagerId, id]);
    
    // Notify all admins about project selection
    try {
      // Get head manager name
      const [headManagerNameRows] = await db.query('SELECT name FROM users WHERE id = ?', [headManagerId]);
      const headManagerName = headManagerNameRows.length > 0 ? headManagerNameRows[0].name : 'Head Manager';
      const project = projectRows[0];
      const adminMessage = `Head Manager ${headManagerName} has selected project "${project.name}"`;
      await Notification.notifyAllAdmins(adminMessage, 'project_selected');
      console.log(`Admin notification sent: ${adminMessage}`);
    } catch (notifError) {
      console.error('Error sending admin notification for project selection:', notifError);
      // Don't fail the request if notification creation fails
    }
    
    res.json({ success: true, message: 'Project selected successfully', selected: true });
  } catch (error) {
    console.error('Error selecting project:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'This project already Selected' });
    }
    res.status(500).json({ success: false, message: 'Failed to select project' });
  }
}

// Get selected projects for current head manager
async function getSelectedProjects(req, res) {
  try {
    const headManagerId = req.user.id;
    const userRole = req.user.role?.toLowerCase();

    if (userRole !== 'head manager') {
      return res.status(403).json({ success: false, message: 'Access denied. Only head managers can view selected projects.' });
    }

    const [rows] = await db.query(`
      SELECT p.*, u.email as manager_email
      FROM projects p
      INNER JOIN head_manager_projects hmp ON p.id = hmp.project_id
      LEFT JOIN users u ON p.manager_id = u.id
      WHERE hmp.head_manager_id = ?
      ORDER BY p.id DESC
    `, [headManagerId]);

    res.json(rows);
  } catch (error) {
    console.error('Error fetching selected projects:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch selected projects' });
  }
}

// Get comments for a project
async function getProjectComments(req, res) {
  try {
    const projectId = parseInt(req.params.id);
    
    if (!projectId || isNaN(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const [comments] = await db.query(`
      SELECT 
        pc.id,
        pc.project_id,
        pc.user_id,
        pc.comment,
        pc.created_at,
        u.email as user_email,
        u.name as user_name
      FROM project_comments pc
      LEFT JOIN users u ON pc.user_id = u.id
      WHERE pc.project_id = ?
      ORDER BY pc.created_at DESC
    `, [projectId]);

    res.json({ success: true, comments });
  } catch (error) {
    console.error('Error fetching project comments:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch project comments' });
  }
}

// Create a comment for a project
async function createProjectComment(req, res) {
  try {
    const projectId = parseInt(req.params.id);
    const userId = req.user.id;
    const { comment } = req.body;

    if (!projectId || isNaN(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    if (!comment || typeof comment !== 'string' || comment.trim() === '') {
      return res.status(400).json({ success: false, message: 'Comment is required' });
    }

    // Verify project exists
    const [projectRows] = await db.query('SELECT id FROM projects WHERE id = ?', [projectId]);
    if (projectRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Insert comment
    const [result] = await db.query(
      'INSERT INTO project_comments (project_id, user_id, comment) VALUES (?, ?, ?)',
      [projectId, userId, comment.trim()]
    );

    // Get the created comment with user info
    const [newComment] = await db.query(`
      SELECT 
        pc.id,
        pc.project_id,
        pc.user_id,
        pc.comment,
        pc.created_at,
        u.email as user_email,
        u.name as user_name
      FROM project_comments pc
      LEFT JOIN users u ON pc.user_id = u.id
      WHERE pc.id = ?
    `, [result.insertId]);

    res.status(201).json({ success: true, comment: newComment[0] });
  } catch (error) {
    console.error('Error creating project comment:', error);
    res.status(500).json({ success: false, message: 'Failed to create comment' });
  }
}

// Update a project comment (only by the comment owner)
async function updateProjectComment(req, res) {
  try {
    const commentId = parseInt(req.params.commentId);
    const userId = req.user.id;
    const { comment } = req.body;

    if (!commentId || isNaN(commentId)) {
      return res.status(400).json({ success: false, message: 'Invalid comment ID' });
    }

    if (!comment || typeof comment !== 'string' || comment.trim() === '') {
      return res.status(400).json({ success: false, message: 'Comment is required' });
    }

    // Check if comment exists and belongs to the user
    const [commentRows] = await db.query(
      'SELECT id, user_id FROM project_comments WHERE id = ?',
      [commentId]
    );

    if (commentRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    if (commentRows[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: 'You can only update your own comments' });
    }

    // Update comment
    await db.query(
      'UPDATE project_comments SET comment = ? WHERE id = ?',
      [comment.trim(), commentId]
    );

    // Get the updated comment with user info
    const [updatedComment] = await db.query(`
      SELECT 
        pc.id,
        pc.project_id,
        pc.user_id,
        pc.comment,
        pc.created_at,
        u.email as user_email,
        u.name as user_name
      FROM project_comments pc
      LEFT JOIN users u ON pc.user_id = u.id
      WHERE pc.id = ?
    `, [commentId]);

    res.json({ success: true, comment: updatedComment[0] });
  } catch (error) {
    console.error('Error updating project comment:', error);
    res.status(500).json({ success: false, message: 'Failed to update comment' });
  }
}

// Delete a project comment (only by the comment owner)
async function deleteProjectComment(req, res) {
  try {
    const commentId = parseInt(req.params.commentId);
    const userId = req.user.id;

    if (!commentId || isNaN(commentId)) {
      return res.status(400).json({ success: false, message: 'Invalid comment ID' });
    }

    // Check if comment exists and belongs to the user
    const [commentRows] = await db.query(
      'SELECT id, user_id FROM project_comments WHERE id = ?',
      [commentId]
    );

    if (commentRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    if (commentRows[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: 'You can only delete your own comments' });
    }

    // Delete comment
    await db.query('DELETE FROM project_comments WHERE id = ?', [commentId]);

    res.json({ success: true, message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Error deleting project comment:', error);
    res.status(500).json({ success: false, message: 'Failed to delete comment' });
  }
}

module.exports = { getAllProjects, createProject, updateProject, deleteProject, assignManagerToProject, selectProject, getSelectedProjects, getProjectComments, createProjectComment, updateProjectComment, deleteProjectComment };
