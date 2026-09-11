const express = require('express');
const sql = require('mssql');
const { DefaultAzureCredential } = require('@azure/identity');
const {
  BlobServiceClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters
} = require('@azure/storage-blob');
const multer = require('multer');
require('dotenv').config();

const app = express();

app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB
  }
});

// -----------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------

const {
  AZURE_SQL_SERVER,
  AZURE_SQL_DATABASE,
  STORAGE_ACCOUNT_NAME
} = process.env;

const CONTAINER_NAME = 'attachments';

let pool;
let blobServiceClient;
let blobContainer;
let credential;

// -----------------------------------------------------
// INITIALIZE AZURE SERVICES
// -----------------------------------------------------

async function initServices() {
  if (!AZURE_SQL_SERVER) {
    throw new Error('AZURE_SQL_SERVER is missing');
  }

  if (!AZURE_SQL_DATABASE) {
    throw new Error('AZURE_SQL_DATABASE is missing');
  }

  if (!STORAGE_ACCOUNT_NAME) {
    throw new Error('STORAGE_ACCOUNT_NAME is missing');
  }

  // Locally:
  // DefaultAzureCredential can use your Azure CLI login.
  //
  // In Azure App Service:
  // it can automatically use the App Service Managed Identity.
  credential = new DefaultAzureCredential();

  // ---------------------------------------------------
  // AZURE SQL - PASSWORDLESS ENTRA AUTHENTICATION
  // ---------------------------------------------------

  const sqlConfig = {
    server: AZURE_SQL_SERVER,
    database: AZURE_SQL_DATABASE,
    port: 1433,

    authentication: {
      type: 'azure-active-directory-default'
    },

    options: {
      encrypt: true,
      trustServerCertificate: false
    },

    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };

  pool = await new sql.ConnectionPool(sqlConfig).connect();

  console.log('Connected to Azure SQL');

  // ---------------------------------------------------
  // AZURE BLOB STORAGE - MANAGED IDENTITY
  // ---------------------------------------------------

  const storageUrl =
    `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`;

  blobServiceClient = new BlobServiceClient(
    storageUrl,
    credential
  );

  blobContainer =
    blobServiceClient.getContainerClient(CONTAINER_NAME);

  await blobContainer.createIfNotExists();

  console.log('Connected to Azure Blob Storage');
}

// -----------------------------------------------------
// HEALTH CHECK
// -----------------------------------------------------

app.get('/api/health', async (req, res) => {
  try {
    await pool.request().query('SELECT 1');

    res.json({
      status: 'healthy',
      database: 'connected',
      storage: 'connected'
    });
  } catch (err) {
    console.error(err);

    res.status(503).json({
      status: 'unhealthy',
      error: err.message
    });
  }
});

// -----------------------------------------------------
// LIST TASKS
// -----------------------------------------------------

app.get('/api/tasks', async (req, res) => {
  try {
    const { status } = req.query;

    let query = 'SELECT * FROM Tasks';
    const request = pool.request();

    if (status) {
      query += ' WHERE Status = @status';

      request.input(
        'status',
        sql.NVarChar(50),
        status
      );
    }

    query += ' ORDER BY CreatedAt DESC';

    const result = await request.query(query);

    res.json(result.recordset);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Failed to retrieve tasks'
    });
  }
});

// -----------------------------------------------------
// GET ONE TASK
// -----------------------------------------------------

app.get('/api/tasks/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: 'Invalid task ID'
      });
    }

    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query(
        'SELECT * FROM Tasks WHERE Id = @id'
      );

    if (!result.recordset.length) {
      return res.status(404).json({
        error: 'Task not found'
      });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Failed to retrieve task'
    });
  }
});

// -----------------------------------------------------
// CREATE TASK
// -----------------------------------------------------

app.post('/api/tasks', async (req, res) => {
  try {
    const {
      title,
      description,
      assignee,
      priority
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        error: 'Title is required'
      });
    }

    const result = await pool
      .request()
      .input(
        'title',
        sql.NVarChar(255),
        title.trim()
      )
      .input(
        'description',
        sql.NVarChar(sql.MAX),
        description || ''
      )
      .input(
        'assignee',
        sql.NVarChar(255),
        assignee || ''
      )
      .input(
        'priority',
        sql.NVarChar(50),
        priority || 'Medium'
      )
      .query(`
        INSERT INTO Tasks
        (
          Title,
          Description,
          Assignee,
          Priority,
          Status,
          CreatedAt
        )

        OUTPUT INSERTED.*

        VALUES
        (
          @title,
          @description,
          @assignee,
          @priority,
          'Open',
          GETUTCDATE()
        )
      `);

    res.status(201).json(
      result.recordset[0]
    );
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Failed to create task'
    });
  }
});

// -----------------------------------------------------
// UPDATE TASK
// -----------------------------------------------------

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: 'Invalid task ID'
      });
    }

    const {
      title,
      description,
      assignee,
      priority,
      status
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        error: 'Title is required'
      });
    }

    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .input(
        'title',
        sql.NVarChar(255),
        title.trim()
      )
      .input(
        'description',
        sql.NVarChar(sql.MAX),
        description || ''
      )
      .input(
        'assignee',
        sql.NVarChar(255),
        assignee || ''
      )
      .input(
        'priority',
        sql.NVarChar(50),
        priority || 'Medium'
      )
      .input(
        'status',
        sql.NVarChar(50),
        status || 'Open'
      )
      .query(`
        UPDATE Tasks

        SET
          Title = @title,
          Description = @description,
          Assignee = @assignee,
          Priority = @priority,
          Status = @status

        OUTPUT INSERTED.*

        WHERE Id = @id
      `);

    if (!result.recordset.length) {
      return res.status(404).json({
        error: 'Task not found'
      });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Failed to update task'
    });
  }
});

// -----------------------------------------------------
// DELETE TASK
// -----------------------------------------------------

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: 'Invalid task ID'
      });
    }

    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        DELETE FROM Tasks
        OUTPUT DELETED.Id
        WHERE Id = @id
      `);

    if (!result.recordset.length) {
      return res.status(404).json({
        error: 'Task not found'
      });
    }

    res.status(204).send();
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Failed to delete task'
    });
  }
});

// -----------------------------------------------------
// UPLOAD ATTACHMENT
// -----------------------------------------------------

app.post(
  '/api/tasks/:id/attachments',
  upload.single('file'),
  async (req, res) => {
    try {
      const taskId = Number(req.params.id);

      if (!Number.isInteger(taskId)) {
        return res.status(400).json({
          error: 'Invalid task ID'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: 'No file uploaded'
        });
      }

      // Make sure task exists first.
      const taskResult = await pool
        .request()
        .input('id', sql.Int, taskId)
        .query(
          'SELECT Id FROM Tasks WHERE Id = @id'
        );

      if (!taskResult.recordset.length) {
        return res.status(404).json({
          error: 'Task not found'
        });
      }

      const file = req.file;

      // Prevent directory/path characters from being
      // inserted into the blob name.
      const safeFileName =
        file.originalname.replace(/[\\/]/g, '_');

      const blobName =
        `${taskId}/${Date.now()}-${safeFileName}`;

      const blockBlob =
        blobContainer.getBlockBlobClient(blobName);

      await blockBlob.uploadData(file.buffer, {
        blobHTTPHeaders: {
          blobContentType: file.mimetype
        }
      });

      await pool
        .request()
        .input(
          'taskId',
          sql.Int,
          taskId
        )
        .input(
          'fileName',
          sql.NVarChar(255),
          file.originalname
        )
        .input(
          'blobName',
          sql.NVarChar(1024),
          blobName
        )
        .input(
          'size',
          sql.BigInt,
          file.size
        )
        .query(`
          INSERT INTO Attachments
          (
            TaskId,
            FileName,
            BlobName,
            Size,
            UploadedAt
          )

          VALUES
          (
            @taskId,
            @fileName,
            @blobName,
            @size,
            GETUTCDATE()
          )
        `);

      res.status(201).json({
        message: 'Uploaded',
        blobName
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Failed to upload attachment'
      });
    }
  }
);

// -----------------------------------------------------
// CREATE READ-ONLY USER-DELEGATION SAS
// -----------------------------------------------------

async function createDownloadSasUrl(blobName) {
  const now = new Date();

  // Start 5 minutes in the past to avoid small clock
  // differences between machines.
  const startsOn =
    new Date(now.getTime() - 5 * 60 * 1000);

  // URL expires in one hour.
  const expiresOn =
    new Date(now.getTime() + 60 * 60 * 1000);

  // Managed Identity / Entra-authenticated request.
  const userDelegationKey =
    await blobServiceClient.getUserDelegationKey(
      startsOn,
      expiresOn
    );

  const sasToken =
    generateBlobSASQueryParameters(
      {
        containerName: CONTAINER_NAME,
        blobName,
        permissions:
          BlobSASPermissions.parse('r'),
        startsOn,
        expiresOn
      },
      userDelegationKey,
      STORAGE_ACCOUNT_NAME
    ).toString();

  const blobClient =
    blobContainer.getBlobClient(blobName);

  return `${blobClient.url}?${sasToken}`;
}

// -----------------------------------------------------
// LIST ATTACHMENTS
// -----------------------------------------------------

app.get(
  '/api/tasks/:id/attachments',
  async (req, res) => {
    try {
      const taskId = Number(req.params.id);

      if (!Number.isInteger(taskId)) {
        return res.status(400).json({
          error: 'Invalid task ID'
        });
      }

      const result = await pool
        .request()
        .input(
          'taskId',
          sql.Int,
          taskId
        )
        .query(`
          SELECT *
          FROM Attachments
          WHERE TaskId = @taskId
          ORDER BY UploadedAt DESC
        `);

      const attachments = await Promise.all(
        result.recordset.map(async (attachment) => {
          const downloadUrl =
            await createDownloadSasUrl(
              attachment.BlobName
            );

          return {
            ...attachment,
            downloadUrl
          };
        })
      );

      res.json(attachments);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Failed to retrieve attachments'
      });
    }
  }
);

// -----------------------------------------------------
// EXPRESS ERROR HANDLER
// -----------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: err.message
    });
  }

  res.status(500).json({
    error: 'Internal server error'
  });
});

// -----------------------------------------------------
// START APPLICATION
// -----------------------------------------------------

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await initServices();

    app.listen(PORT, () => {
      console.log(
        `CloudTask API running on port ${PORT}`
      );
    });
  } catch (err) {
    console.error(
      'CloudTask failed to start:',
      err
    );

    process.exit(1);
  }
}

start();