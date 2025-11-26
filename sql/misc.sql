-- Test local insertion
INSERT INTO Riders (courierName, vehicleType, firstName, lastName, gender, age, createdAt, updatedAt)
VALUES ('JNT','Motorcycle','Test','Rider','M',25,NOW(),NOW());

SELECT * FROM Riders;

-- Reset all tables
TRUNCATE TABLE Riders;
TRUNCATE TABLE Logs;

-- Drop everything
DROP DATABASE IF EXISTS ridersdb;
DROP TRIGGER IF EXISTS riders_after_insert;
DROP TRIGGER IF EXISTS riders_after_update;
DROP TRIGGER IF EXISTS riders_after_delete;

-- Show triggers
SHOW TRIGGERS;

-- Show tables
SHOW TABLES;

-- Show table definition
SHOW CREATE TABLE Riders;

-- List trigger names
SELECT CONCAT('DROP TRIGGER `', TRIGGER_NAME, '`;')
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE();

-- Modify enum values
ALTER TABLE Riders
MODIFY COLUMN vehicleType ENUM('Motorcycle', 'Bicycle', 'Tricycle', 'Car') NOT NULL;

-- Create user with all privileges
CREATE USER 'root'@'%' IDENTIFIED BY (insert password);
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;

-- Check MySQL users
SELECT host, user FROM mysql.user;

-- Modify column
ALTER TABLE Logs
  MODIFY COLUMN status ENUM('pending','replicated','failed') DEFAULT 'pending';
