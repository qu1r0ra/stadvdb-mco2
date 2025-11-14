DELIMITER $$

CREATE TRIGGER riders_after_insert
AFTER INSERT ON Riders
FOR EACH ROW
BEGIN
  INSERT INTO Logs(tx_id, node_name, action, rider_id, old_value, new_value)
  VALUES (
    UUID(),
    'node1',
    'INSERT',
    NEW.id,
    NULL,
    JSON_OBJECT(
      'id', NEW.id,
      'courierName', NEW.courierName,
      'vehicleType', NEW.vehicleType,
      'firstName', NEW.firstName,
      'lastName', NEW.lastName,
      'gender', NEW.gender,
      'age', NEW.age,
      'createdAt', NEW.createdAt,
      'updatedAt', NEW.updatedAt
    )
  );
END$$

CREATE TRIGGER riders_after_update
AFTER UPDATE ON Riders
FOR EACH ROW
BEGIN
  INSERT INTO Logs(tx_id, node_name, action, rider_id, old_value, new_value)
  VALUES (
    UUID(),
    'node1',
    'UPDATE',
    NEW.id,
    JSON_OBJECT(
      'id', OLD.id,
      'courierName', OLD.courierName,
      'vehicleType', OLD.vehicleType,
      'firstName', OLD.firstName,
      'lastName', OLD.lastName,
      'gender', OLD.gender,
      'age', OLD.age,
      'createdAt', OLD.createdAt,
      'updatedAt', OLD.updatedAt
    ),
    JSON_OBJECT(
      'id', NEW.id,
      'courierName', NEW.courierName,
      'vehicleType', NEW.vehicleType,
      'firstName', NEW.firstName,
      'lastName', NEW.lastName,
      'gender', NEW.gender,
      'age', NEW.age,
      'createdAt', NEW.createdAt,
      'updatedAt', NEW.updatedAt
    )
  );
END$$

CREATE TRIGGER riders_after_delete
AFTER DELETE ON Riders
FOR EACH ROW
BEGIN
  INSERT INTO Logs(tx_id, node_name, action, rider_id, old_value, new_value)
  VALUES (
    UUID(),
    'node1',
    'DELETE',
    OLD.id,
    JSON_OBJECT(
      'id', OLD.id,
      'courierName', OLD.courierName,
      'vehicleType', OLD.vehicleType,
      'firstName', OLD.firstName,
      'lastName', OLD.lastName,
      'gender', OLD.gender,
      'age', OLD.age,
      'createdAt', OLD.createdAt,
      'updatedAt', OLD.updatedAt
    ),
    NULL
  );
END$$

DELIMITER ;
