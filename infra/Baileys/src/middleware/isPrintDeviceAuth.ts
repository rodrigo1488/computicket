import { Request, Response, NextFunction } from "express";
import PrintDevice from "../models/PrintDevice";
import AppError from "../errors/AppError";

export interface PrintDeviceAuthRequest extends Request {
  companyId?: number;
  printDevice?: PrintDevice;
}

/**
 * Auth do PrintAgent: Authorization Bearer {token} + X-Device-Id.
 * Mesmo par usado no upgrade WebSocket /ws/print.
 */
const isPrintDeviceAuth = async (
  req: PrintDeviceAuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token: string | null = null;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    }
    const deviceIdHeader = req.headers["x-device-id"];
    const deviceId =
      typeof deviceIdHeader === "string" ? deviceIdHeader.trim() : null;

    if (!token || !deviceId) {
      throw new AppError("ERR_PRINT_DEVICE_UNAUTHORIZED", 401);
    }

    const device = await PrintDevice.findOne({
      where: { token, deviceId },
    });
    if (!device) {
      throw new AppError("ERR_PRINT_DEVICE_UNAUTHORIZED", 401);
    }

    req.companyId = device.companyId;
    req.printDevice = device;
    return next();
  } catch (err) {
    next(err);
  }
};

export default isPrintDeviceAuth;
