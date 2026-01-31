const bcrypt = require('bcrypt');
const { MongoClient } = require('mongodb');

async function addTestAccounts() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('clinicalmatch');
  const users = db.collection('users');
  
  const testAccounts = [
    { email: 'test1@demo.com', password: 'Demo123!', name: 'Demo User 1' },
    { email: 'test2@demo.com', password: 'Demo123!', name: 'Demo User 2' },
    { email: 'simple@test.com', password: 'Simple123', name: 'Simple Test' },
    { email: 'easy@login.com', password: 'Password1', name: 'Easy Login' }
  ];
  
  for (let account of testAccounts) {
    const existing = await users.findOne({ email: account.email });
    if (!existing) {
      const hashedPassword = await bcrypt.hash(account.password, 12);
      await users.insertOne({
        email: account.email,
        password: hashedPassword,
        name: account.name,
        createdAt: new Date()
      });
      console.log(`✅ Added: ${account.email} / ${account.password}`);
    } else {
      console.log(`⚠️ Exists: ${account.email}`);
    }
  }
  
  await client.close();
  console.log('✅ Done adding test accounts');
}

addTestAccounts().catch(console.error);