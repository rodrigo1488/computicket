import { Request, Response } from "express";
import * as Yup from "yup";
import { getIO } from "../libs/socket";
import AppError from "../errors/AppError";

import CreateService from "../services/UserAppointmentService/CreateService";
import ListService from "../services/UserAppointmentService/ListService";
import ShowService from "../services/UserAppointmentService/ShowService";
import UpdateService from "../services/UserAppointmentService/UpdateService";
import DeleteService from "../services/UserAppointmentService/DeleteService";

interface IndexQuery {
    filterType?: "all" | "myAppointments" | "assignedToMe";
    searchParam?: string;
    pageNumber?: string;
}

export const index = async (req: Request, res: Response): Promise<Response> => {
    const { companyId, id, profile } = req.user;
    const userId = Number(id);
    const { filterType, searchParam, pageNumber } = req.query as IndexQuery;

    const { appointments, count, hasMore } = await ListService({
        companyId,
        userId,
        userProfile: profile,
        filterType,
        searchParam,
        pageNumber,
    });

    return res.json({ appointments, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
    const { companyId, id } = req.user;
    const userId = Number(id);

    const schema = Yup.object().shape({
        title: Yup.string().required("Title is required"),
        description: Yup.string(),
        startTime: Yup.date().required("Start time is required"),
        endTime: Yup.date().required("End time is required"),
        assignedUserId: Yup.number(),
        status: Yup.string().oneOf(["pending", "confirmed", "cancelled", "completed"]),
        reminderMinutes: Yup.number(),
    });

    try {
        await schema.validate(req.body);
    } catch (err: any) {
        throw new AppError(err.message);
    }

    const {
        title,
        description,
        startTime,
        endTime,
        assignedUserId,
        status,
        reminderMinutes,
    } = req.body;

    const appointment = await CreateService({
        title,
        description,
        startTime,
        endTime,
        userId,
        assignedUserId,
        companyId,
        status,
        reminderMinutes,
    });

    const io = getIO();
    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-user-appointment`, {
        action: "create",
        appointment,
    });

    return res.status(200).json(appointment);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;

    const appointment = await ShowService(id);

    return res.status(200).json(appointment);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
    const { companyId } = req.user;
    const { id } = req.params;

    const schema = Yup.object().shape({
        title: Yup.string(),
        description: Yup.string(),
        startTime: Yup.date(),
        endTime: Yup.date(),
        assignedUserId: Yup.number(),
        status: Yup.string().oneOf(["pending", "confirmed", "cancelled", "completed"]),
        reminderMinutes: Yup.number(),
    });

    try {
        await schema.validate(req.body);
    } catch (err: any) {
        throw new AppError(err.message);
    }

    const {
        title,
        description,
        startTime,
        endTime,
        assignedUserId,
        status,
        reminderMinutes,
    } = req.body;

    const appointment = await UpdateService({
        appointmentId: id,
        title,
        description,
        startTime,
        endTime,
        assignedUserId,
        status,
        reminderMinutes,
    });

    const io = getIO();
    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-user-appointment`, {
        action: "update",
        appointment,
    });

    return res.status(200).json(appointment);
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
    const { companyId } = req.user;
    const { id } = req.params;

    await DeleteService(id);

    const io = getIO();
    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-user-appointment`, {
        action: "delete",
        appointmentId: id,
    });

    return res.status(200).json({ message: "Appointment deleted" });
};
