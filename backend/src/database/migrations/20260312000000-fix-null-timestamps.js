'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(
      'UPDATE "users" SET "created_at" = NOW() WHERE "created_at" IS NULL'
    );
    await queryInterface.sequelize.query(
      'UPDATE "users" SET "updated_at" = NOW() WHERE "updated_at" IS NULL'
    );
  },

  down: async (queryInterface, Sequelize) => {
    // This migration is not reversible
  }
};
