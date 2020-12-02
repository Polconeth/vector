/* eslint-disable @typescript-eslint/no-empty-function */
import {
  ChannelSigner,
  getRandomChannelSigner,
  createTestChannelUpdateWithSigners,
  createTestChannelStateWithSigners,
  getRandomBytes32,
  createTestUpdateParams,
  mkAddress,
  mkSig,
  expect,
  MemoryStoreService,
  MemoryMessagingService,
} from "@connext/vector-utils";
import {
  UpdateType,
  ChannelUpdate,
  InboundChannelUpdateError,
  OutboundChannelUpdateError,
  Result,
  UpdateParams,
  FullChannelState,
  FullTransferState,
} from "@connext/vector-types";
import { BigNumber } from "@ethersproject/bignumber";
import { AddressZero } from "@ethersproject/constants";
import pino from "pino";
import Sinon from "sinon";
import { VectorChainReader } from "@connext/vector-contracts";

// Import as full module for easy sinon function mocking
import * as vectorUpdate from "../update";
import * as vectorUtils from "../utils";
import * as vectorValidation from "../validate";
import { inbound, outbound } from "../sync";

import { env } from "./env";

describe("inbound", () => {
  const chainProviders = env.chainProviders;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [chainIdStr, providerUrl] = Object.entries(chainProviders)[0] as string[];
  const inbox = getRandomBytes32();
  const logger = pino().child({
    testName: "inbound",
  });
  const externalValidation = {
    validateOutbound: (params: UpdateParams<any>, state: FullChannelState, transfer?: FullTransferState) =>
      Promise.resolve(Result.ok(undefined)),
    validateInbound: (update: ChannelUpdate<any>, state: FullChannelState, transfer?: FullTransferState) =>
      Promise.resolve(Result.ok(undefined)),
  };

  let signers: ChannelSigner[];
  let store: Sinon.SinonStubbedInstance<MemoryStoreService>;
  let messaging: Sinon.SinonStubbedInstance<MemoryMessagingService>;
  let chainService: Sinon.SinonStubbedInstance<VectorChainReader>;

  let validationStub: Sinon.SinonStub;

  beforeEach(async () => {
    signers = Array(2)
      .fill(0)
      .map(() => getRandomChannelSigner(providerUrl));
    store = Sinon.createStubInstance(MemoryStoreService);
    messaging = Sinon.createStubInstance(MemoryMessagingService);
    chainService = Sinon.createStubInstance(VectorChainReader);

    // Set the validation stub
    validationStub = Sinon.stub(vectorValidation, "validateAndApplyInboundUpdate");
  });

  afterEach(() => {
    Sinon.restore();
  });

  it("should fail if you are 3+ states behind the update", async () => {
    // Generate the update
    const prevUpdate: ChannelUpdate<typeof UpdateType.setup> = createTestChannelUpdateWithSigners(
      signers,
      UpdateType.setup,
      {
        nonce: 1,
      },
    );

    const update: ChannelUpdate<typeof UpdateType.setup> = createTestChannelUpdateWithSigners(
      signers,
      UpdateType.setup,
      {
        nonce: 5,
      },
    );

    const result = await inbound(
      update,
      prevUpdate,
      inbox,
      chainService,
      store,
      messaging,
      externalValidation,
      signers[1],
      logger,
    );

    expect(result.isError).to.be.true;
    const error = result.getError()!;
    expect(error.message).to.be.eq(InboundChannelUpdateError.reasons.StaleChannel);
    // Make sure the calls were correctly performed
    expect(validationStub.callCount).to.be.eq(0);
    expect(store.saveChannelState.callCount).to.be.eq(0);
    expect(messaging.respondToProtocolMessage.callCount).to.be.eq(0);
  });

  it("should fail if validating the update fails", async () => {
    // Generate the update
    const update: ChannelUpdate<typeof UpdateType.deposit> = createTestChannelUpdateWithSigners(
      signers,
      UpdateType.deposit,
      {
        nonce: 1,
      },
    );
    // Set the validation stub
    validationStub.resolves(
      Result.fail(
        new InboundChannelUpdateError(InboundChannelUpdateError.reasons.InboundValidationFailed, update, {} as any),
      ),
    );

    const result = await inbound(
      update,
      update,
      inbox,
      chainService,
      store,
      messaging,
      externalValidation,
      signers[1],
      logger,
    );

    expect(result.isError).to.be.true;
    const error = result.getError()!;
    expect(error.message).to.be.eq(InboundChannelUpdateError.reasons.InboundValidationFailed);
    // Make sure the calls were correctly performed
    expect(validationStub.callCount).to.be.eq(1);
    expect(store.saveChannelState.callCount).to.be.eq(0);
    expect(messaging.respondToProtocolMessage.callCount).to.be.eq(0);
  });

  it("should fail if saving the data fails", async () => {
    // Generate the update
    store.saveChannelState.rejects();

    const update: ChannelUpdate<typeof UpdateType.setup> = createTestChannelUpdateWithSigners(
      signers,
      UpdateType.setup,
      {
        nonce: 1,
      },
    );
    // Set the validation stub
    validationStub.resolves(Result.ok({ updatedChannel: {} as any }));
    const result = await inbound(
      update,
      update,
      inbox,
      chainService,
      store,
      messaging,
      externalValidation,
      signers[1],
      logger,
    );

    expect(result.isError).to.be.true;
    const error = result.getError()!;
    expect(error.message).to.be.eq(InboundChannelUpdateError.reasons.SaveChannelFailed);
    // Make sure the calls were correctly performed
    expect(validationStub.callCount).to.be.eq(1);
    expect(store.saveChannelState.callCount).to.be.eq(1);
    expect(messaging.respondToProtocolMessage.callCount).to.be.eq(0);
  });

  it("IFF update is invalid and channel is out of sync, should fail on retry, but sync properly", async () => {
    const prevUpdate: ChannelUpdate<typeof UpdateType.setup> = createTestChannelUpdateWithSigners(
      signers,
      UpdateType.setup,
      {
        nonce: 1,
      },
    );
    validationStub.onFirstCall().resolves(Result.ok({ updatedChannel: { nonce: 1, latestUpdate: {} as any } }));

    const update: ChannelUpdate<typeof UpdateType.deposit> = createTestChannelUpdateWithSigners(
      signers,
      UpdateType.deposit,
      {
        nonce: 2,
      },
    );
    validationStub
      .onSecondCall()
      .resolves(
        Result.fail(
          new InboundChannelUpdateError(InboundChannelUpdateError.reasons.InboundValidationFailed, update, {} as any),
        ),
      );
    const result = await inbound(
      update,
      prevUpdate,
      inbox,
      chainService,
      store,
      messaging,
      externalValidation,
      signers[1],
      logger,
    );

    expect(result.isError).to.be.true;
    const error = result.getError()!;
    expect(error.message).to.be.eq(InboundChannelUpdateError.reasons.InboundValidationFailed);
    expect(validationStub.callCount).to.be.eq(2);
    expect(validationStub.firstCall.args[0].nonce).to.be.eq(1);
    expect(validationStub.secondCall.args[0].nonce).to.be.eq(2);
    // Make sure the calls were correctly performed
    expect(store.saveChannelState.callCount).to.be.eq(1);
    expect(messaging.respondToProtocolMessage.callCount).to.be.eq(0);
  });

  describe("should sync channel and retry update IFF state nonce is behind by 2 updates", async () => {
    describe("initiator trying deposit", () => {
      it("missed deposit, should work", async () => {
        // Set the store mock
        store.getChannelState.resolves({ nonce: 1, latestUpdate: {} as any } as any);

        // Set the validation mock
        validationStub.onFirstCall().resolves(Result.ok({ updatedChannel: { nonce: 2, latestUpdate: {} as any } }));
        validationStub.onSecondCall().resolves(Result.ok({ updatedChannel: { nonce: 3, latestUpdate: {} as any } }));

        // Create the update to sync
        const toSync = createTestChannelUpdateWithSigners(signers, UpdateType.deposit, { nonce: 2 });

        // Create the update to propose
        const update = createTestChannelUpdateWithSigners(signers, UpdateType.deposit, { nonce: 3 });

        const result = await inbound(
          update,
          toSync,
          inbox,
          chainService,
          store,
          messaging,
          externalValidation,
          signers[1],
          logger,
        );
        expect(result.getError()).to.be.undefined;
        // Verify callstack
        expect(messaging.respondToProtocolMessage.callCount).to.be.eq(1);
        expect(messaging.respondWithProtocolError.callCount).to.be.eq(0);
        expect(store.saveChannelState.callCount).to.be.eq(2);
        expect(validationStub.callCount).to.be.eq(2);
        expect(validationStub.firstCall.args[0].nonce).to.be.eq(2);
        expect(validationStub.secondCall.args[0].nonce).to.be.eq(3);
      });
      it("missed create, should work", async () => {
        // Set the store mock
        store.getChannelState.resolves({ nonce: 1, latestUpdate: {} as any } as any);

        // Set the validation mock
        validationStub.onFirstCall().resolves(Result.ok({ updatedChannel: { nonce: 2, latestUpdate: {} as any } }));
        validationStub.onSecondCall().resolves(Result.ok({ updatedChannel: { nonce: 3, latestUpdate: {} as any } }));

        // Create the update to sync
        const toSync = createTestChannelUpdateWithSigners(signers, UpdateType.create, { nonce: 2 });

        // Create the update to propose
        const update = createTestChannelUpdateWithSigners(signers, UpdateType.deposit, { nonce: 3 });

        const result = await inbound(
          update,
          toSync,
          inbox,
          chainService,
          store,
          messaging,
          externalValidation,
          signers[1],
          logger,
        );

        expect(result.getError()).to.be.undefined;
        // Verify callstack
        expect(messaging.respondToProtocolMessage.callCount).to.be.eq(1);
        expect(messaging.respondWithProtocolError.callCount).to.be.eq(0);
        expect(store.saveChannelState.callCount).to.be.eq(2);
        expect(validationStub.callCount).to.be.eq(2);
        expect(validationStub.firstCall.args[0].nonce).to.be.eq(2);
        expect(validationStub.secondCall.args[0].nonce).to.be.eq(3);
      });
      it("missed resolve, should work", async () => {
        // Set the store mock
        store.getChannelState.resolves({ nonce: 1, latestUpdate: {} as any } as any);

        // Set the validation mock
        validationStub.onFirstCall().resolves(Result.ok({ updatedChannel: { nonce: 2, latestUpdate: {} as any } }));
        validationStub.onSecondCall().resolves(Result.ok({ updatedChannel: { nonce: 3, latestUpdate: {} as any } }));

        // Create the update to sync
        const toSync = createTestChannelUpdateWithSigners(signers, UpdateType.resolve, { nonce: 2 });

        // Create the update to propose
        const update = createTestChannelUpdateWithSigners(signers, UpdateType.deposit, { nonce: 3 });

        const result = await inbound(
          update,
          toSync,
          inbox,
          chainService,
          store,
          messaging,
          externalValidation,
          signers[1],
          logger,
        );

        expect(result.getError()).to.be.undefined;
        // Verify callstack
        expect(messaging.respondToProtocolMessage.callCount).to.be.eq(1);
        expect(messaging.respondWithProtocolError.callCount).to.be.eq(0);
        expect(store.saveChannelState.callCount).to.be.eq(2);
        expect(validationStub.callCount).to.be.eq(2);
        expect(validationStub.firstCall.args[0].nonce).to.be.eq(2);
        expect(validationStub.secondCall.args[0].nonce).to.be.eq(3);
      });
    });

    describe("initiator trying create", () => {
      it("missed deposit, should work", async () => {
        // Set the store mock
        store.getChannelState.resolves({ nonce: 1, latestUpdate: {} as any } as any);

        // Set the validation mock
        validationStub.onFirstCall().resolves(Result.ok({ updatedChannel: { nonce: 2, latestUpdate: {} as any } }));
        validationStub.onSecondCall().resolves(Result.ok({ updatedChannel: { nonce: 3, latestUpdate: {} as any } }));

        // Create the update to sync
        const toSync = createTestChannelUpdateWithSigners(signers, UpdateType.deposit, { nonce: 2 });

        // Create the update to propose
        const update = createTestChannelUpdateWithSigners(signers, UpdateType.create, { nonce: 3 });

        const result = await inbound(
          update,
          toSync,
          inbox,
          chainService,
          store,
          messaging,
          externalValidation,
          signers[1],
          logger,
        );

        expect(result.getError()).to.be.undefined;
        // Verify callstack
        expect(messaging.respondToProtocolMessage.callCount).to.be.eq(1);
        expect(messaging.respondWithProtocolError.callCount).to.be.eq(0);
        expect(store.saveChannelState.callCount).to.be.eq(2);
        expect(validationStub.callCount).to.be.eq(2);
        expect(validationStub.firstCall.args[0].nonce).to.be.eq(2);
        expect(validationStub.secondCall.args[0].nonce).to.be.eq(3);
      });
      it("missed create, should work", async () => {
        // Set the store mock
        store.getChannelState.resolves({ nonce: 1, latestUpdate: {} as any } as any);

        // Set the validation mock
        validationStub.onFirstCall().resolves(Result.ok({ updatedChannel: { nonce: 2, latestUpdate: {} as any } }));
        validationStub.onSecondCall().resolves(Result.ok({ updatedChannel: { nonce: 3, latestUpdate: {} as any } }));

        // Create the update to sync
        const toSync = createTestChannelUpdateWithSigners(signers, UpdateType.create, { nonce: 2 });

        // Create the update to propose
        const update = createTestChannelUpdateWithSigners(signers, UpdateType.create, { nonce: 3 });

        const result = await inbound(
          update,
          toSync,
          inbox,
          chainService,
          store,
          messaging,
          externalValidation,
          signers[1],
          logger,
        );

        expect(result.getError()).to.be.undefined;
        // Verify callstack
        expect(messaging.respondToProtocolMessage.callCount).to.be.eq(1);
        expect(messaging.respondWithProtocolError.callCount).to.be.eq(0);
        expect(store.saveChannelState.callCount).to.be.eq(2);
        expect(validationStub.callCount).to.be.eq(2);
        expect(validationStub.firstCall.args[0].nonce).to.be.eq(2);
        expect(validationStub.secondCall.args[0].nonce).to.be.eq(3);
      });
      it("missed resolve, should work", async () => {
        // Set the store mock
        store.getChannelState.resolves({ nonce: 1, latestUpdate: {} as any } as any);

        // Set the validation mock
        validationStub.onFirstCall().resolves(Result.ok({ updatedChannel: { nonce: 2, latestUpdate: {} as any } }));
        validationStub.onSecondCall().resolves(Result.ok({ updatedChannel: { nonce: 3, latestUpdate: {} as any } }));

        // Create the update to sync
        const toSync = createTestChannelUpdateWithSigners(signers, UpdateType.resolve, { nonce: 2 });

        // Create the update to propose
        const update = createTestChannelUpdateWithSigners(signers, UpdateType.create, { nonce: 3 });

        const result = await inbound(
          update,
          toSync,
          inbox,
          chainService,
          store,
          messaging,
          externalValidation,
          signers[1],
          logger,
        );

        expect(result.getError()).to.be.undefined;
        // Verify callstack
        expect(messaging.respondToProtocolMessage.callCount).to.be.eq(1);
        expect(messaging.respondWithProtocolError.callCount).to.be.eq(0);
        expect(store.saveChannelState.callCount).to.be.eq(2);
        expect(validationStub.callCount).to.be.eq(2);
        expect(validationStub.firstCall.args[0].nonce).to.be.eq(2);
        expect(validationStub.secondCall.args[0].nonce).to.be.eq(3);
      });
    });

    describe("initiator trying resolve", () => {
      it("missed deposit, should work", async () => {
        // Set the store mock
        store.getChannelState.resolves({ nonce: 1, latestUpdate: {} as any } as any);

        // Set the validation mock
        validationStub.onFirstCall().resolves(Result.ok({ updatedChannel: { nonce: 2, latestUpdate: {} as any } }));
        validationStub.onSecondCall().resolves(Result.ok({ updatedChannel: { nonce: 3, latestUpdate: {} as any } }));

        // Create the update to sync
        const toSync = createTestChannelUpdateWithSigners(signers, UpdateType.deposit, { nonce: 2 });

        // Create the update to propose
        const update = createTestChannelUpdateWithSigners(signers, UpdateType.resolve, { nonce: 3 });

        const result = await inbound(
          update,
          toSync,
          inbox,
          chainService,
          store,
          messaging,
          externalValidation,
          signers[1],
          logger,
        );

        expect(result.getError()).to.be.undefined;
        // Verify callstack
        expect(messaging.respondToProtocolMessage.callCount).to.be.eq(1);
        expect(messaging.respondWithProtocolError.callCount).to.be.eq(0);
        expect(store.saveChannelState.callCount).to.be.eq(2);
        expect(validationStub.callCount).to.be.eq(2);
        expect(validationStub.firstCall.args[0].nonce).to.be.eq(2);
        expect(validationStub.secondCall.args[0].nonce).to.be.eq(3);
      });
      it("missed create, should work", async () => {
        // Set the store mock
        store.getChannelState.resolves({ nonce: 1, latestUpdate: {} as any } as any);

        // Set the validation mock
        validationStub.onFirstCall().resolves(Result.ok({ updatedChannel: { nonce: 2, latestUpdate: {} as any } }));
        validationStub.onSecondCall().resolves(Result.ok({ updatedChannel: { nonce: 3, latestUpdate: {} as any } }));

        // Create the update to sync
        const toSync = createTestChannelUpdateWithSigners(signers, UpdateType.create, { nonce: 2 });

        // Create the update to propose
        const update = createTestChannelUpdateWithSigners(signers, UpdateType.resolve, { nonce: 3 });

        const result = await inbound(
          update,
          toSync,
          inbox,
          chainService,
          store,
          messaging,
          externalValidation,
          signers[1],
          logger,
        );

        expect(result.getError()).to.be.undefined;
        // Verify callstack
        expect(messaging.respondToProtocolMessage.callCount).to.be.eq(1);
        expect(messaging.respondWithProtocolError.callCount).to.be.eq(0);
        expect(store.saveChannelState.callCount).to.be.eq(2);
        expect(validationStub.callCount).to.be.eq(2);
        expect(validationStub.firstCall.args[0].nonce).to.be.eq(2);
        expect(validationStub.secondCall.args[0].nonce).to.be.eq(3);
      });
      it("missed resolve, should work", async () => {
        // Set the store mock
        store.getChannelState.resolves({ nonce: 1, latestUpdate: {} as any } as any);

        // Set the validation mock
        validationStub.onFirstCall().resolves(Result.ok({ updatedChannel: { nonce: 2, latestUpdate: {} as any } }));
        validationStub.onSecondCall().resolves(Result.ok({ updatedChannel: { nonce: 3, latestUpdate: {} as any } }));

        // Create the update to sync
        const toSync = createTestChannelUpdateWithSigners(signers, UpdateType.resolve, { nonce: 2 });

        // Create the update to propose
        const update = createTestChannelUpdateWithSigners(signers, UpdateType.resolve, { nonce: 3 });

        const result = await inbound(
          update,
          toSync,
          inbox,
          chainService,
          store,
          messaging,
          externalValidation,
          signers[1],
          logger,
        );

        expect(result.getError()).to.be.undefined;
        // Verify callstack
        expect(messaging.respondToProtocolMessage.callCount).to.be.eq(1);
        expect(messaging.respondWithProtocolError.callCount).to.be.eq(0);
        expect(store.saveChannelState.callCount).to.be.eq(2);
        expect(validationStub.callCount).to.be.eq(2);
        expect(validationStub.firstCall.args[0].nonce).to.be.eq(2);
        expect(validationStub.secondCall.args[0].nonce).to.be.eq(3);
      });
    });
  });

  it("should work if there is no channel state stored and you are receiving a setup update", async () => {
    // Generate the update
    const update: ChannelUpdate<typeof UpdateType.setup> = createTestChannelUpdateWithSigners(
      signers,
      UpdateType.setup,
      {
        nonce: 1,
      },
    );
    // Set the validation stub
    validationStub.resolves(Result.ok({ updatedChannel: {} as any }));
    const result = await inbound(
      update,
      update,
      inbox,
      chainService,
      store,
      messaging,
      externalValidation,
      signers[1],
      logger,
    );
    expect(result.getError()).to.be.undefined;

    // Make sure the calls were correctly performed
    expect(validationStub.callCount).to.be.eq(1);
    expect(messaging.respondToProtocolMessage.callCount).to.be.eq(1);
    expect(store.saveChannelState.callCount).to.be.eq(1);
  });

  it("should return an error if the update does not advance state", async () => {
    // Set the store mock
    store.getChannelState.resolves({ nonce: 1, latestUpdate: {} as any } as any);

    // Generate an update at nonce = 1
    const update = createTestChannelUpdateWithSigners(signers, UpdateType.setup, { nonce: 1 });

    const result = await inbound(
      update,
      {} as any,
      inbox,
      chainService,
      store,
      messaging,
      externalValidation,
      signers[1],
      logger,
    );
    expect(result.isError).to.be.true;
    const error = result.getError()!;
    expect(error.message).to.be.eq(InboundChannelUpdateError.reasons.StaleUpdate);

    // Verify calls
    expect(messaging.respondWithProtocolError.callCount).to.be.eq(1);
    expect(store.saveChannelState.callCount).to.be.eq(0);
  });

  it("should work if stored state is behind (update nonce = stored nonce + 2)", async () => {
    // Set the store mock
    store.getChannelState.resolves({ nonce: 1, latestUpdate: {} as any } as any);

    // Set the validation mock
    validationStub.onFirstCall().resolves(Result.ok({ updatedChannel: { nonce: 2, latestUpdate: {} as any } }));
    validationStub.onSecondCall().resolves(Result.ok({ updatedChannel: { nonce: 3, latestUpdate: {} as any } }));

    // Create the update to sync
    const toSync = createTestChannelUpdateWithSigners(signers, UpdateType.deposit, { nonce: 2 });

    // Create the update to propose
    const update = createTestChannelUpdateWithSigners(signers, UpdateType.deposit, { nonce: 3 });

    const result = await inbound(
      update,
      toSync,
      inbox,
      chainService,
      store,
      messaging,
      externalValidation,
      signers[1],
      logger,
    );
    expect(result.getError()).to.be.undefined;

    // Verify callstack
    expect(messaging.respondToProtocolMessage.callCount).to.be.eq(1);
    expect(messaging.respondWithProtocolError.callCount).to.be.eq(0);
    expect(store.saveChannelState.callCount).to.be.eq(2);
    expect(validationStub.callCount).to.be.eq(2);
    expect(validationStub.firstCall.args[0].nonce).to.be.eq(2);
    expect(validationStub.secondCall.args[0].nonce).to.be.eq(3);
  });

  it("should update if stored state is in sync", async () => {
    // Set the store mock
    store.getChannelState.resolves({ nonce: 1, latestUpdate: {} as any } as any);

    // Set the validation stub
    validationStub.resolves(Result.ok({ updatedChannel: { nonce: 3 } as any }));

    // Create the update to sync with (in this case, a deposit)
    const update = createTestChannelUpdateWithSigners(signers, UpdateType.deposit, {
      nonce: 2,
    });

    // Call `inbound`
    const result = await inbound(
      update,
      update,
      inbox,
      chainService,
      store,
      messaging,
      externalValidation,
      signers[1],
      logger,
    );
    expect(result.getError()).to.be.undefined;

    // Verify callstack
    expect(messaging.respondToProtocolMessage.callCount).to.be.eq(1);
    expect(messaging.respondWithProtocolError.callCount).to.be.eq(0);
    expect(store.saveChannelState.callCount).to.be.eq(1);
    expect(validationStub.callCount).to.be.eq(1);
  });
});

describe("outbound", () => {
  const chainProviders = env.chainProviders;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const providerUrl = Object.values(chainProviders)[0] as string;
  const logger = pino().child({
    testName: "inbound",
  });
  const channelAddress = mkAddress("0xccc");
  const externalValidation = {
    validateOutbound: (params: UpdateParams<any>, state: FullChannelState, transfer?: FullTransferState) =>
      Promise.resolve(Result.ok(undefined)),
    validateInbound: (update: ChannelUpdate<any>, state: FullChannelState, transfer?: FullTransferState) =>
      Promise.resolve(Result.ok(undefined)),
  };

  let signers: ChannelSigner[];
  let store: Sinon.SinonStubbedInstance<MemoryStoreService>;
  let messaging: Sinon.SinonStubbedInstance<MemoryMessagingService>;
  let chainService: Sinon.SinonStubbedInstance<VectorChainReader>;

  let outboundValidationStub: Sinon.SinonStub;
  let generationStub: Sinon.SinonStub;

  beforeEach(async () => {
    signers = Array(2)
      .fill(0)
      .map(() => getRandomChannelSigner(providerUrl));

    // Create all the services stubs
    store = Sinon.createStubInstance(MemoryStoreService);
    messaging = Sinon.createStubInstance(MemoryMessagingService);
    chainService = Sinon.createStubInstance(VectorChainReader);

    // Set the validation + generation mock
    outboundValidationStub = Sinon.stub(vectorValidation, "validateUpdateParams").resolves(Result.ok(undefined));
    generationStub = Sinon.stub(vectorUpdate, "generateAndApplyUpdate");

    // Stub out all signature validation
    Sinon.stub(vectorUtils, "validateChannelUpdateSignatures").resolves(Result.ok(undefined));
  });

  afterEach(() => {
    // Always restore stubs after tests
    Sinon.restore();
  });

  it("should fail if it fails to validate the update", async () => {
    const params = createTestUpdateParams(UpdateType.deposit, { channelAddress: "0xfail" });

    // Stub the validation function
    const error = new OutboundChannelUpdateError(OutboundChannelUpdateError.reasons.InvalidParams, params);
    outboundValidationStub.resolves(Result.fail(error));

    const res = await outbound(params, store, chainService, messaging, externalValidation, signers[0], logger);
    expect(res.getError()).to.be.deep.eq(error);
  });

  it("should fail if it fails to generate the update", async () => {
    const params = createTestUpdateParams(UpdateType.deposit, { channelAddress: "0xfail" });

    // Stub the generate update function
    const error = new OutboundChannelUpdateError(OutboundChannelUpdateError.reasons.InvalidParams, params);
    generationStub.resolves(Result.fail(error));

    const res = await outbound(params, store, chainService, messaging, externalValidation, signers[0], logger);
    expect(res.isError).to.be.true;
    expect(res.getError()).to.be.deep.eq(error);
  });

  it("should fail if it counterparty update fails for some reason other than update being out of date", async () => {
    // Create a setup update
    const params = createTestUpdateParams(UpdateType.setup, {
      channelAddress,
      details: { counterpartyIdentifier: signers[1].publicIdentifier },
    });
    // Create a messaging service stub
    const counterpartyError = new InboundChannelUpdateError(InboundChannelUpdateError.reasons.RestoreNeeded, {} as any);
    messaging.sendProtocolMessage.resolves(Result.fail(counterpartyError));

    // Stub the generation function
    generationStub.resolves(
      Result.ok({
        update: createTestChannelUpdateWithSigners(signers, UpdateType.deposit),
        updatedTransfer: undefined,
        updatedActiveTransfers: undefined,
        updatedChannel: createTestChannelStateWithSigners(signers, UpdateType.deposit),
      }),
    );

    // Call the outbound function
    const res = await outbound(params, store, chainService, messaging, externalValidation, signers[0], logger);

    // Verify the error is returned as an outbound error
    const error = res.getError();
    expect(error?.message).to.be.eq(OutboundChannelUpdateError.reasons.CounterpartyFailure);
    expect(error?.context).to.deep.eq({ counterpartyError: counterpartyError.message });

    // Verify message only sent once by initiator
    expect(messaging.sendProtocolMessage.callCount).to.be.eq(1);
  });

  it("should successfully initiate an update if channels are in sync", async () => {
    // Create the update (a user deposit on a setup channel)
    const assetId = AddressZero;
    const depositBAmt = BigNumber.from(16);
    const params: UpdateParams<typeof UpdateType.deposit> = createTestUpdateParams(UpdateType.deposit, {
      channelAddress,
      details: { assetId },
    });

    // Create the channel and store mocks for the user
    // channel at nonce 1, proposes nonce 2, syncs nonce 2 from counterparty
    // then proposes nonce 3
    store.getChannelState.resolves(createTestChannelStateWithSigners(signers, UpdateType.setup, { nonce: 2 }));

    // Set the onchain service mocks
    chainService.getChannelOnchainBalance.resolves(Result.ok(depositBAmt));

    // Stub the generation results
    generationStub.onFirstCall().resolves(
      Result.ok({
        update: createTestChannelUpdateWithSigners(signers, UpdateType.deposit),
        updatedTransfer: undefined,
        updatedActiveTransfers: undefined,
        updatedChannel: createTestChannelStateWithSigners(signers, UpdateType.deposit, { nonce: 3 }),
      }),
    );

    // Set the messaging mocks to return the proper update from the counterparty
    messaging.sendProtocolMessage // fails returning update to sync from
      .onFirstCall()
      .resolves(Result.ok({ update: {}, previousUpdate: {} } as any));

    // Call the outbound function
    const res = await outbound(params, store, chainService, messaging, externalValidation, signers[0], logger);

    // Verify return values
    expect(res.getError()).to.be.undefined;
    expect(res.getValue().updatedChannel).to.containSubset({ nonce: 3 });

    // Verify message only sent once by initiator w/update to sync
    expect(messaging.sendProtocolMessage.callCount).to.be.eq(1);
    // Verify sync happened
    expect(generationStub.callCount).to.be.eq(1);
    expect(outboundValidationStub.callCount).to.be.eq(1);
    expect(store.saveChannelState.callCount).to.be.eq(1);
  });

  it("should fail if update to sync is single signed", async () => {
    const singleSignedUpdate = createTestChannelUpdateWithSigners(signers, UpdateType.deposit, {
      aliceSignature: mkSig("0xaaabbb"),
      bobSignature: undefined,
      nonce: 1,
    });

    const error = new OutboundChannelUpdateError(OutboundChannelUpdateError.reasons.InvalidParams, singleSignedUpdate);
    outboundValidationStub.resolves(Result.fail(error));

    const result = await outbound(
      singleSignedUpdate,
      store,
      chainService,
      messaging,
      externalValidation,
      signers[0],
      logger,
    );

    expect(result.isError).to.be.true;
    expect(result.getError()).to.be.deep.eq(error);
  });

  it("should fail if the channel is not saved to store", async () => {
    // Stub save method to fail
    store.saveChannelState.rejects("Failed to save channel");

    const params = createTestUpdateParams(UpdateType.deposit, {
      channelAddress,
    });

    // Stub the generation results
    generationStub.resolves(
      Result.ok({
        update: createTestChannelUpdateWithSigners(signers, UpdateType.deposit),
        updatedTransfer: undefined,
        updatedActiveTransfers: undefined,
        updatedChannel: createTestChannelStateWithSigners(signers, UpdateType.deposit),
      }),
    );

    // Set the messaging mocks to return the proper update from the counterparty
    messaging.sendProtocolMessage.onFirstCall().resolves(Result.ok({ update: {}, previousUpdate: {} } as any));

    const result = await outbound(params, store, chainService, messaging, externalValidation, signers[0], logger);

    expect(result.isError).to.be.true;
    const error = result.getError()!;
    expect(error.message).to.be.eq(OutboundChannelUpdateError.reasons.SaveChannelFailed);
  });

  it.only("IFF update is valid and channel is out of sync, sync properly and should fail if update is invalid for synced channel", async () => {
    store.getChannelState.resolves(createTestChannelStateWithSigners(signers, UpdateType.resolve, { nonce: 2 }));

    const params: UpdateParams<typeof UpdateType.resolve> = createTestUpdateParams(UpdateType.resolve, {
      channelAddress,
    });

    // Stub the validation function
    outboundValidationStub.onFirstCall().resolves(Result.ok({ updatedChannel: { nonce: 2, latestUpdate: {} as any } }));

    const error = new OutboundChannelUpdateError(OutboundChannelUpdateError.reasons.InvalidParams, params);
    outboundValidationStub.onSecondCall().resolves(Result.fail(error));

    const result = await outbound(params, store, chainService, messaging, externalValidation, signers[0], logger);

    expect(result.isError).to.be.true;
    expect(outboundValidationStub.callCount).to.be.eq(2);
  });

  // responder nonce n, proposed update nonce by initiator is at n too.
  // then if update is valid for synced channel then initiator nonce is n+1
  describe("should sync channel and retry update IFF update from responder nonce === stored nonce for update initiator", async () => {
    describe("initiator trying deposit", () => {
      // Assume the initiator is Alice, and she is always trying to reconcile
      // a deposit. Generate test constants
      const assetId = AddressZero;
      const userBBalance = BigNumber.from(9);
      const missedUpdateNonce = 2;
      const depositAAmt = BigNumber.from(14);
      const depositANonce = BigNumber.from(1);
      const params: UpdateParams<typeof UpdateType.deposit> = createTestUpdateParams(UpdateType.deposit, {
        channelAddress,
        details: { assetId },
      });

      beforeEach(() => {
        // Set the chain service mock
        chainService.getChannelOnchainBalance.resolves(Result.ok(userBBalance.add(depositAAmt)));
      });

      afterEach(() => {
        // Always restore stubs after tests
        Sinon.restore();
      });

      it("missed deposit, should work", async () => {
        // Assume initiator missed a user deposit
        // Create the missed update
        const missedUpdate = createTestChannelUpdateWithSigners(signers, UpdateType.deposit, {
          nonce: missedUpdateNonce,
        });

        // Create the expected final double signed update state
        const signedUpdate = createTestChannelUpdateWithSigners(signers, UpdateType.deposit, {
          aliceSignature: mkSig("0xaaabbb"),
          bobSignature: mkSig("0xcccddd"),
          nonce: missedUpdateNonce + 1,
        });

        // Set messaging mocks:
        // - first call should return an error
        // - second call should return a final channel state
        const counterpartyError = new InboundChannelUpdateError(
          InboundChannelUpdateError.reasons.StaleUpdate,
          missedUpdate,
        );
        messaging.sendProtocolMessage.onCall(0).resolves(Result.fail(counterpartyError));
        messaging.sendProtocolMessage
          .onCall(1)
          .resolves(Result.ok({ update: signedUpdate, previousUpdate: missedUpdate }));

        // Stub the generation results
        generationStub.onCall(0).resolves(
          Result.ok({
            update: createTestChannelUpdateWithSigners(signers, UpdateType.deposit, { nonce: missedUpdateNonce }),
            updatedTransfer: undefined,
            updatedActiveTransfers: undefined,
            updatedChannel: createTestChannelStateWithSigners(signers, UpdateType.deposit, {
              nonce: missedUpdateNonce,
            }),
          }),
        );
        generationStub.onCall(1).resolves(
          Result.ok({
            update: createTestChannelUpdateWithSigners(signers, UpdateType.deposit, { nonce: missedUpdateNonce + 1 }),
            updatedTransfer: undefined,
            updatedActiveTransfers: undefined,
            updatedChannel: createTestChannelStateWithSigners(signers, UpdateType.deposit, {
              nonce: missedUpdateNonce + 1,
            }),
          }),
        );

        // Generate the initiators stale channel, and set store mock
        const staleChannel = createTestChannelStateWithSigners(signers, UpdateType.setup, {
          nonce: missedUpdateNonce - 1,
        });
        store.getChannelState.resolves(staleChannel);

        // Call the outbound function
        const res = await outbound(params, store, chainService, messaging, externalValidation, signers[0], logger);

        // Verify the update was successfully sent + retried
        expect(res.getError()).to.be.undefined;
        expect(res.getValue().updatedChannel).to.be.containSubset({
          nonce: signedUpdate.nonce,
          latestUpdate: signedUpdate,
          channelAddress,
        });
        expect(messaging.sendProtocolMessage.callCount).to.be.eq(2);
        expect(store.saveChannelState.callCount).to.be.eq(2);
      });

      it.skip("missed create, should work", async () => {});
      it.skip("missed resolve, should work", async () => {});
    });

    describe.skip("initiator trying create", () => {
      it("missed deposit, should work", async () => {});
      it("missed create, should work", async () => {});
      it("missed resolve, should work", async () => {});
    });

    describe.skip("initiator trying resolve", () => {
      it("missed deposit, should work", async () => {});
      it("missed create, should work", async () => {});
      it("missed resolve, should work", async () => {});
    });
  });
});
