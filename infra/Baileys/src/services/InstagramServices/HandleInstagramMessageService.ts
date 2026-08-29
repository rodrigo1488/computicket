import { getIO } from "../../libs/socket";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { logger } from "../../utils/logger";

interface InstagramMessageData {
    messageId: string;
    senderId: string; // IGSID
    body: string;
    timestamp: number;
    isFromMe: boolean;
}

const HandleInstagramMessageService = async (
    messageData: InstagramMessageData,
    whatsapp: Whatsapp
): Promise<void> => {
    const { messageId, senderId, body, timestamp, isFromMe } = messageData;

    try {
        // 1. Find or Create Contact
        const contactData = {
            name: `Instagram User ${senderId.slice(-4)}`, // Placeholder until we fetch profile
            number: senderId,
            profilePicUrl: "",
            isGroup: false,
            companyId: whatsapp.companyId,
            whatsappId: whatsapp.id
        };

        const contact = await CreateOrUpdateContactService(contactData);

        // 2. Find or Create Ticket
        const ticket = await FindOrCreateTicketService(
            contact,
            whatsapp.id,
            1, // unreadMessages
            whatsapp.companyId
        );

        // 3. Create Message
        const msgData = {
            id: messageId,
            ticketId: ticket.id,
            contactId: contact.id, // Who sent the message
            body: body,
            fromMe: isFromMe,
            read: isFromMe, // If I sent it, it's read. If I received it, it's unread.
            mediaType: "chat",
            mediaUrl: undefined,
            timestamp: timestamp, // Note: CreateMessageService might use createdAt/updatedAt logic
            status: "received"
        };

        await CreateMessageService({
            messageData: msgData,
            companyId: whatsapp.companyId
        });

    } catch (err) {
        logger.error(`Error handling Instagram message: ${err}`);
        throw err;
    }
};

export default HandleInstagramMessageService;
