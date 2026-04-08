import dotenv from 'dotenv';
import * as sdk from 'node-appwrite';

dotenv.config();

const { Client, Databases, Permission, Role } = sdk;

const endpoint = process.env.APPWRITE_ENDPOINT ?? process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT;
const projectId =
  process.env.APPWRITE_PROJECT_ID ?? process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;
const databaseId =
  process.env.APPWRITE_DATABASE_ID ?? process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID;
const collectionId =
  process.env.APPWRITE_COLLECTION_ID ?? process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_ID;

if (!endpoint || !projectId || !apiKey || !databaseId || !collectionId) {
  throw new Error(
    'Missing required env vars. Set APPWRITE_API_KEY and EXPO_PUBLIC_APPWRITE_ENDPOINT/PROJECT_ID/DATABASE_ID/COLLECTION_ID in .env.'
  );
}

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const databases = new Databases(client);

const isConflictError = (error) => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return Number(error.code) === 409;
};

const isAttributeNotAvailableError = (error) => {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error) ||
    !('type' in error)
  ) {
    return false;
  }

  return Number(error.code) === 400 && String(error.type) === 'attribute_not_available';
};

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const createOrSkip = async (label, operation) => {
  try {
    await operation();
    console.log(`Created ${label}.`);
  } catch (error) {
    if (isConflictError(error)) {
      console.log(`${label} already exists.`);
      return;
    }

    throw error;
  }
};

await createOrSkip('database', async () => {
  await databases.create(databaseId, 'DairyDatabase', true);
});

await createOrSkip('diary collection', async () => {
  await databases.createCollection(
    databaseId,
    collectionId,
    'DiaryEntries',
    [
      Permission.create(Role.users()),
    ],
    true,
    true
  );
});

await databases.updateCollection(
  databaseId,
  collectionId,
  'DiaryEntries',
  [
    Permission.create(Role.users()),
  ],
  true,
  true
);
console.log('Updated diary collection permissions.');

await createOrSkip('text attribute', async () => {
  await databases.createStringAttribute(databaseId, collectionId, 'text', 4000, true);
});

await createOrSkip('createdAt attribute', async () => {
  await databases.createDatetimeAttribute(
    databaseId,
    collectionId,
    'createdAt',
    true
  );
});

await createOrSkip('ownerId attribute', async () => {
  await databases.createStringAttribute(databaseId, collectionId, 'ownerId', 64, true);
});

for (let attempt = 1; attempt <= 8; attempt += 1) {
  try {
    await databases.createIndex(
      databaseId,
      collectionId,
      'owner_created_desc',
      'key',
      ['ownerId', 'createdAt'],
      ['ASC', 'DESC']
    );
    console.log('Created owner_created_desc index.');
    break;
  } catch (error) {
    if (isConflictError(error)) {
      console.log('owner_created_desc index already exists.');
      break;
    }

    if (isAttributeNotAvailableError(error) && attempt < 8) {
      console.log(`Waiting for attributes to become available (attempt ${attempt}/8)...`);
      await sleep(1500);
      continue;
    }

    throw error;
  }
}

console.log('Appwrite diary table setup complete.');
