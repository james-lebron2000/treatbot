const mongoose = require('mongoose');
const { seedTrials } = require('./seedData');
require('dotenv').config();

async function setupDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clinicalmatch');
    console.log('Connected to MongoDB');

    console.log('Seeding clinical trials data...');
    const result = await seedTrials();
    
    if (result.success) {
      console.log(`Successfully seeded ${result.count} clinical trials`);
    } else {
      console.error('Failed to seed data:', result.error);
    }

    await mongoose.disconnect();
    console.log('Database setup completed');
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  }
}

setupDatabase();