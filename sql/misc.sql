-- Test local insertion
INSERT INTO Riders (courierName, vehicleType, firstName, lastName, gender, age, createdAt, updatedAt)
VALUES ('JNT','Motorcycle','Test','Rider','M',25,NOW(),NOW());

SELECT * FROM Riders;

-- Reset all tables
TRUNCATE TABLE Riders;
TRUNCATE TABLE Logs;
