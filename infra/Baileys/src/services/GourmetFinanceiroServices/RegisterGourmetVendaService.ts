import GourmetFinanceiro from "../../models/GourmetFinanceiro";
import { getBrazilISODateString } from "../../helpers/BrazilTimezone";

interface DescontoFields {
  subtotal?: number | null;
  desconto?: number | null;
  descontoTipo?: string | null;
  descontoValor?: number | null;
}

interface RequestMesa {
  companyId: number;
  tipo: "mesa";
  valor: number;
  meiosPagamento?: any;
  mesaId: number;
  mesaNumero?: string | null;
}

interface RequestDelivery {
  companyId: number;
  tipo: "delivery";
  valor: number;
  meiosPagamento?: any;
  formResponseId: number;
  protocol?: string | null;
  entregadorUserId?: number | null;
  entregadorNome?: string | null;
}

interface RequestPdv {
  companyId: number;
  tipo: "pdv";
  valor: number;
  meiosPagamento?: any;
  itens?: Array<{ productName: string; quantity: number; productValue: number }>;
}

type Request = (RequestMesa | RequestDelivery | RequestPdv) & DescontoFields;

const RegisterGourmetVendaService = async (data: Request): Promise<GourmetFinanceiro> => {
  const today = getBrazilISODateString(new Date());
  const payload: any = {
    companyId: data.companyId,
    tipo: data.tipo,
    valor: data.valor,
    dataVenda: today,
    meiosPagamento: (data as any).meiosPagamento ?? null,
    subtotal: data.subtotal ?? null,
    desconto: data.desconto ?? 0,
    descontoTipo: data.descontoTipo ?? null,
    descontoValor: data.descontoValor ?? null,
  };
  if (data.tipo === "mesa") {
    payload.mesaId = data.mesaId;
    payload.mesaNumero = data.mesaNumero ?? null;
    payload.formResponseId = null;
    payload.protocol = null;
    payload.entregadorUserId = null;
    payload.entregadorNome = null;
  } else if (data.tipo === "pdv") {
    payload.mesaId = null;
    payload.mesaNumero = null;
    payload.formResponseId = null;
    payload.protocol = null;
    payload.entregadorUserId = null;
    payload.entregadorNome = null;
    payload.itens = (data as RequestPdv).itens ?? null;
  } else {
    payload.mesaId = null;
    payload.mesaNumero = null;
    payload.formResponseId = data.formResponseId;
    payload.protocol = data.protocol ?? null;
    payload.entregadorUserId = data.entregadorUserId ?? null;
    payload.entregadorNome = data.entregadorNome ?? null;
  }
  const record = await GourmetFinanceiro.create(payload);
  return record;
};

export default RegisterGourmetVendaService;
