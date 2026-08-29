import Invoices from "../../models/Invoices";
import moment from "moment";

interface InvoiceData {
  detail: string;
  value: number;
  companyId: number;
  dueDate?: string;
  status?: string;
}

const CreateInvoiceService = async (
  invoiceData: InvoiceData
): Promise<Invoices> => {
  const { detail, value, companyId, dueDate, status } = invoiceData;

  const invoice = await Invoices.create({
    detail,
    value,
    companyId,
    dueDate: dueDate || moment().add(30, "days").format(),
    status: status || "pending",
  });

  return invoice;
};

export default CreateInvoiceService;

