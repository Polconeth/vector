import {
  INodeService,
  NodeParams,
  NodeResponses,
  OptionalPublicIdentifier,
  Result,
  EngineEvent,
  EngineEventMap,
  GrpcTypes,
  jsonifyError,
} from "@connext/vector-types";
import { ChannelCredentials } from "@grpc/grpc-js";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { BaseLogger } from "pino";
import Ajv from "ajv";
import * as grpc from "@grpc/grpc-js";

import { ServerNodeServiceError } from "./errors";

const ajv = new Ajv();

const getStreamNameForEvent = <T extends EngineEvent>(eventName: T): string => {
  switch (eventName) {
    case "CONDITIONAL_TRANSFER_CREATED":
      return "conditionalTransferCreatedStream";
    case "CONDITIONAL_TRANSFER_RESOLVED":
      return "conditionalTransferResolvedStream";
    case "DEPOSIT_RECONCILED":
      return "depositReconciledStream";
    case "IS_ALIVE":
      return "isAliveStream";
    case "REQUEST_COLLATERAL":
      return "requestCollateralStream";
    case "RESTORE_STATE_EVENT":
      return "restoreStateStream";
    case "SETUP":
      return "setupStream";
    case "WITHDRAWAL_CREATED":
      return "withdrawalCreatedStream";
    case "WITHDRAWAL_RECONCILED":
      return "withdrawalReconciledStream";
    case "WITHDRAWAL_RESOLVED":
      return "withdrawalResolvedStream";
    default:
      throw new Error("Unknown event");
  }
};
export class GRPCServerNodeClient implements INodeService {
  public publicIdentifier = "";
  public signerAddress = "";
  private client: GrpcTypes.ServerNodeServiceClient;

  private constructor(private readonly serverNodeUrl: string, private readonly logger: BaseLogger) {
    const transport = new GrpcTransport({
      host: this.serverNodeUrl,
      channelCredentials: ChannelCredentials.createInsecure(),
    });
    this.client = new GrpcTypes.ServerNodeServiceClient(transport);
  }

  static async connect(
    serverNodeUrl: string,
    logger: BaseLogger,
    index?: number,
    skipCheckIn?: boolean,
  ): Promise<GRPCServerNodeClient> {
    const service = new GRPCServerNodeClient(serverNodeUrl, logger);
    // If an index is provided, the service will only host a single engine
    // and the publicIdentifier will be automatically included in parameters
    if (typeof index === "number") {
      // Create the public identifier and signer address
      const node = await service.createNode({ index, skipCheckIn });
      if (node.isError) {
        logger.error({ error: node.getError()!.message, method: "connect" }, "Failed to create node");
        throw node.getError();
      }
      const { publicIdentifier, signerAddress } = node.getValue();
      service.publicIdentifier = publicIdentifier;
      service.signerAddress = signerAddress;
    }

    return service;
  }

  async getPing(): Promise<Result<string, ServerNodeServiceError>> {
    const res = await this.validateAndExecuteGrpcRequest<GrpcTypes.Empty, GrpcTypes.GenericMessageResponse>(
      "getPing",
      {},
    );
    return res.isError ? Result.fail(res.getError()) : Result.ok(res.getValue().message);
  }

  async getStatus(publicIdentifier?: string): Promise<Result<NodeResponses.GetStatus, ServerNodeServiceError>> {
    return this.validateAndExecuteGrpcRequest<
      OptionalPublicIdentifier<GrpcTypes.GenericPublicIdentifierRequest>,
      GrpcTypes.Status
    >(
      "getStatus",
      {
        publicIdentifier,
      },
      NodeParams.GetConfigSchema,
    );
  }

  getRouterConfig(
    params: OptionalPublicIdentifier<NodeParams.GetRouterConfig>,
  ): Promise<Result<NodeResponses.GetRouterConfig, ServerNodeServiceError>> {
    return this.validateAndExecuteGrpcRequest<
      OptionalPublicIdentifier<GrpcTypes.GetRouterConfigRequest>,
      GrpcTypes.RouterConfig
    >("getRouterConfig", params, NodeParams.GetRouterConfigSchema) as any;
  }

  async getConfig(): Promise<Result<NodeResponses.GetConfig, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  sendDisputeChannelTx(
    params: OptionalPublicIdentifier<NodeParams.SendDisputeChannelTx>,
  ): Promise<Result<NodeResponses.SendDisputeChannelTx, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  sendDefundChannelTx(
    params: OptionalPublicIdentifier<NodeParams.SendDefundChannelTx>,
  ): Promise<Result<NodeResponses.SendDefundChannelTx, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  sendDisputeTransferTx(
    params: OptionalPublicIdentifier<NodeParams.SendDisputeTransferTx>,
  ): Promise<Result<NodeResponses.SendDisputeTransferTx, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  sendDefundTransferTx(
    params: OptionalPublicIdentifier<NodeParams.SendDefundTransferTx>,
  ): Promise<Result<NodeResponses.SendDefundTransferTx, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async createNode(params: NodeParams.CreateNode): Promise<Result<NodeResponses.CreateNode, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async getStateChannel(
    params: OptionalPublicIdentifier<NodeParams.GetChannelState>,
  ): Promise<Result<NodeResponses.GetChannelState, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async getStateChannels(
    params: OptionalPublicIdentifier<NodeParams.GetChannelStates>,
  ): Promise<Result<NodeResponses.GetChannelStates, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async getTransfersByRoutingId(
    params: OptionalPublicIdentifier<NodeParams.GetTransferStatesByRoutingId>,
  ): Promise<Result<NodeResponses.GetTransferStatesByRoutingId, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async getTransferByRoutingId(
    params: OptionalPublicIdentifier<NodeParams.GetTransferStateByRoutingId>,
  ): Promise<Result<NodeResponses.GetTransferStateByRoutingId, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async getTransfer(
    params: OptionalPublicIdentifier<NodeParams.GetTransferState>,
  ): Promise<Result<NodeResponses.GetTransferState, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }
  async getActiveTransfers(
    params: OptionalPublicIdentifier<NodeParams.GetActiveTransfersByChannelAddress>,
  ): Promise<Result<NodeResponses.GetActiveTransfersByChannelAddress, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async getStateChannelByParticipants(
    params: OptionalPublicIdentifier<NodeParams.GetChannelStateByParticipants>,
  ): Promise<Result<NodeResponses.GetChannelStateByParticipants, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  getRegisteredTransfers(
    params: OptionalPublicIdentifier<NodeParams.GetRegisteredTransfers>,
  ): Promise<Result<NodeResponses.GetRegisteredTransfers, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  restoreState(
    params: OptionalPublicIdentifier<NodeParams.RestoreState>,
  ): Promise<Result<NodeResponses.RestoreState, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async setup(
    params: OptionalPublicIdentifier<NodeParams.RequestSetup>,
  ): Promise<Result<NodeResponses.RequestSetup, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async internalSetup(
    params: OptionalPublicIdentifier<NodeParams.Setup>,
  ): Promise<Result<NodeResponses.Setup, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async sendDepositTx(
    params: OptionalPublicIdentifier<NodeParams.SendDepositTx>,
  ): Promise<Result<NodeResponses.SendDepositTx, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async reconcileDeposit(
    params: OptionalPublicIdentifier<NodeParams.Deposit>,
  ): Promise<Result<NodeResponses.Deposit, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async requestCollateral(
    params: OptionalPublicIdentifier<NodeParams.RequestCollateral>,
  ): Promise<Result<NodeResponses.RequestCollateral, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async conditionalTransfer(
    params: OptionalPublicIdentifier<NodeParams.ConditionalTransfer>,
  ): Promise<Result<NodeResponses.ConditionalTransfer, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async resolveTransfer(
    params: OptionalPublicIdentifier<NodeParams.ResolveTransfer>,
  ): Promise<Result<NodeResponses.ResolveTransfer, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async withdraw(
    params: OptionalPublicIdentifier<NodeParams.Withdraw>,
  ): Promise<Result<NodeResponses.Withdraw, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  signUtilityMessage(
    params: OptionalPublicIdentifier<NodeParams.SignUtilityMessage>,
  ): Promise<Result<NodeResponses.SignUtilityMessage, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  sendIsAliveMessage(
    params: OptionalPublicIdentifier<NodeParams.SendIsAlive>,
  ): Promise<Result<NodeResponses.SendIsAlive, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  public once<T extends EngineEvent>(
    event: T,
    callback: (payload: EngineEventMap[T]) => void | Promise<void>,
    filter: (payload: EngineEventMap[T]) => boolean = () => true,
    publicIdentifier?: string,
  ): void {
    throw new Error("unimplemented");
  }

  public on<T extends EngineEvent>(
    event: T,
    callback: (payload: EngineEventMap[T]) => void | Promise<void>,
    filter: (payload: EngineEventMap[T]) => boolean = () => true,
    publicIdentifier?: string,
  ): void {
    const streamName = getStreamNameForEvent(event);
    const stream = this.client[streamName]({
      publicIdentifier: publicIdentifier ?? this.publicIdentifier,
    });
    (async () => {
      for await (const data of stream.response) {
        console.log("on ====> data: ", data);
        if (filter(data as any)) {
          callback(data as any);
        }
      }
    })();
  }

  public waitFor<T extends EngineEvent>(
    event: T,
    timeout: number,
    filter: (payload: EngineEventMap[T]) => boolean = () => true,
    publicIdentifier?: string,
  ): Promise<EngineEventMap[T] | undefined> {
    throw new Error("unimplemented");
  }

  public off<T extends EngineEvent>(event: T, publicIdentifier?: string): void {
    throw new Error("unimplemented");
  }

  // Helper methods
  private async validateAndExecuteGrpcRequest<T, U>(
    methodName: string,
    params: T,
    paramSchema?: any,
  ): Promise<Result<U, ServerNodeServiceError>> {
    const filled = { publicIdentifier: this.publicIdentifier, ...params };
    if (paramSchema) {
      // Validate parameters are in line with schema
      const validate = ajv.compile(paramSchema);
      // IFF the public identifier is undefined, it should be overridden by
      // the pubId defined in the parameters.
      if (!validate(filled)) {
        return Result.fail(
          new ServerNodeServiceError(
            ServerNodeServiceError.reasons.InvalidParams,
            (filled as any).publicIdentifer,
            methodName,
            params,
            {
              paramsError: validate.errors?.map((err) => err.message).join(","),
            },
          ),
        );
      }
    }

    // Attempt request
    try {
      const call = await this.client[methodName](filled);
      console.log("call: ", call);
      this.logger.debug({ call, methodName, filled }, "gRPC call complete");
      if (call.status !== grpc.status.OK) {
        const toThrow = new ServerNodeServiceError(
          ServerNodeServiceError.reasons.InternalServerError,
          filled.publicIdentifier,
          methodName,
          params,
          {
            call,
          },
        );
        return Result.fail(toThrow);
      }
      return Result.ok(call.response);
    } catch (e) {
      this.logger.error({ error: jsonifyError(e), methodName, params: filled }, "Error occurred");
      const toThrow = new ServerNodeServiceError(
        ServerNodeServiceError.reasons.InternalServerError,
        filled.publicIdentifier,
        methodName,
        params,
        {
          error: jsonifyError(e),
        },
      );
      return Result.fail(toThrow);
    }
  }
}