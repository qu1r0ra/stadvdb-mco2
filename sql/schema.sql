-- create database
CREATE DATABASE IF NOT EXISTS ridersdb;
USE ridersdb;

-- Riders table
CREATE TABLE IF NOT EXISTS Riders (
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

-- Logs table
CREATE TABLE IF NOT EXISTS Logs (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tx_id VARCHAR(50) NOT NULL,
  node_name ENUM('node1', 'node2', 'node3') NOT NULL,
  action ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL,
  rider_id INT NOT NULL,
  old_value JSON,
  new_value JSON,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
