CREATE DATABASE IF NOT EXISTS ridersdb;
USE ridersdb;

CREATE TABLE Riders (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  courierName ENUM('JNT', 'LBCD', 'FEDEZ') NOT NULL,
  vehicleType ENUM('Motorcycle', 'Bike', 'Trike', 'Car') NOT NULL,
  firstName VARCHAR(50) NOT NULL,
  lastName VARCHAR(50) NOT NULL,
  gender VARCHAR(10) NOT NULL,
  age INT,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL
);
