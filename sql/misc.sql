-- Test local insertion
INSERT INTO Riders (courierName, vehicleType, firstName, lastName, gender, age, createdAt, updatedAt)
VALUES ('JNT','Motorcycle','Test','Rider','M',25,NOW(),NOW());

SELECT * FROM Riders;

-- Reset all tables
TRUNCATE TABLE Riders;
TRUNCATE TABLE Logs;

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
