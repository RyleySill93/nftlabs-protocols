import { ethers } from "hardhat";
import { expect } from "chai";

// Contract Types
import { Forwarder } from "../../typechain/Forwarder";
import { AccessNFT } from "../../typechain/AccessNFT";
import { Market } from "../../typechain/Market";
import { Coin } from "../../typechain/Coin";

// Types
import { BigNumber } from "ethers";
import { BytesLike } from "@ethersproject/bytes";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// Test utils
import { getContracts, Contracts } from "../../utils/tests/getContracts";
import { getURIs, getAmounts, getBoundedEtherAmount, getAmountBounded } from "../../utils/tests/params";
import { sendGaslessTx } from "../../utils/tests/gasless";

describe("List token for sale", function () {
  // Signers
  let protocolProvider: SignerWithAddress;
  let protocolAdmin: SignerWithAddress;
  let creator: SignerWithAddress;
  let relayer: SignerWithAddress;

  // Contracts
  let market: Market;
  let accessNft: AccessNFT;
  let coin: Coin;
  let forwarder: Forwarder;

  // Reward parameters
  const rewardURIs: string[] = getURIs();
  const accessURIs = getURIs(rewardURIs.length);
  const rewardSupplies: number[] = getAmounts(rewardURIs.length);
  const emptyData: BytesLike = ethers.utils.toUtf8Bytes("");

  // Token IDs
  let rewardId: number = 1;

  // Market params
  const price: BigNumber = getBoundedEtherAmount();
  const amountOfTokenToList = getAmountBounded(rewardSupplies[0]);
  const tokensPerBuyer = getAmountBounded(parseInt(amountOfTokenToList.toString()));
  const openStartAndEnd: number = 0;

  before(async () => {
    // Get signers
    const signers: SignerWithAddress[] = await ethers.getSigners();
    [protocolProvider, protocolAdmin, creator, relayer] = signers;
  });

  beforeEach(async () => {
    // Get contracts
    const contracts: Contracts = await getContracts(protocolProvider, protocolAdmin);
    market = contracts.market;
    accessNft = contracts.accessNft;
    coin = contracts.coin;
    forwarder = contracts.forwarder;

    // Grant minter role to creator
    const MINTER_ROLE = await accessNft.MINTER_ROLE();
    await accessNft.connect(protocolAdmin).grantRole(MINTER_ROLE, creator.address);

    // Create access tokens
    await sendGaslessTx(creator, forwarder, relayer, {
      from: creator.address,
      to: accessNft.address,
      data: accessNft.interface.encodeFunctionData("createAccessTokens", [
        creator.address,
        rewardURIs,
        accessURIs,
        rewardSupplies,
        emptyData,
      ]),
    });
  });

  describe("Revert", async () => {
    it("Should revert if Market is not approved to transfer listed tokens", async () => {
      await expect(
        sendGaslessTx(creator, forwarder, relayer, {
          from: creator.address,
          to: market.address,
          data: market.interface.encodeFunctionData("list", [
            accessNft.address,
            rewardId,
            coin.address,
            price,
            amountOfTokenToList,
            tokensPerBuyer,
            openStartAndEnd,
            openStartAndEnd,
          ]),
        }),
      ).to.be.reverted;
    });

    it("Should revert if lister does not have a role", async () => {
      expect(await market.hasRole(await market.LISTER_ROLE(), creator.address)).to.equal(false);
      expect(await market.hasRole(await market.DEFAULT_ADMIN_ROLE(), creator.address)).to.equal(false);
      await market.connect(protocolAdmin).setRestrictedListerRoleOnly(true);
      await expect(
        sendGaslessTx(creator, forwarder, relayer, {
          from: creator.address,
          to: market.address,
          data: market.interface.encodeFunctionData("list", [
            accessNft.address,
            rewardId,
            coin.address,
            price,
            amountOfTokenToList,
            tokensPerBuyer,
            openStartAndEnd,
            openStartAndEnd,
          ]),
        }),
      ).to.be.reverted;
    });

    it("Should revert if no amount of tokens is listed", async () => {
      await sendGaslessTx(creator, forwarder, relayer, {
        from: creator.address,
        to: accessNft.address,
        data: accessNft.interface.encodeFunctionData("setApprovalForAll", [market.address, true]),
      });

      const invalidQuantity: number = 0;

      await expect(
        sendGaslessTx(creator, forwarder, relayer, {
          from: creator.address,
          to: market.address,
          data: market.interface.encodeFunctionData("list", [
            accessNft.address,
            rewardId,
            coin.address,
            price,
            invalidQuantity,
            tokensPerBuyer,
            openStartAndEnd,
            openStartAndEnd,
          ]),
        }),
      ).to.be.revertedWith("Market: must list at least one token.");
    });

    it("Should revert if buy limit for buyer is greater than total quantity of listing", async () => {
      await sendGaslessTx(creator, forwarder, relayer, {
        from: creator.address,
        to: accessNft.address,
        data: accessNft.interface.encodeFunctionData("setApprovalForAll", [market.address, true]),
      });

      const invalidTokensPerBuyer: BigNumber = amountOfTokenToList.add(1);

      await expect(
        sendGaslessTx(creator, forwarder, relayer, {
          from: creator.address,
          to: market.address,
          data: market.interface.encodeFunctionData("list", [
            accessNft.address,
            rewardId,
            coin.address,
            price,
            amountOfTokenToList,
            invalidTokensPerBuyer,
            openStartAndEnd,
            openStartAndEnd,
          ]),
        }),
      ).to.be.revertedWith("Market: cannot let buyer buy more than listed quantity.");
    });
  });

  describe("Events", function () {
    beforeEach(async () => {
      // Approve Market to transfer tokens
      await sendGaslessTx(creator, forwarder, relayer, {
        from: creator.address,
        to: accessNft.address,
        data: accessNft.interface.encodeFunctionData("setApprovalForAll", [market.address, true]),
      });
    });

    it("Should emit NewListing", async () => {
      const listingId: BigNumber = await market.totalListings();

      const eventPromise = new Promise((resolve, reject) => {
        market.on("NewListing", (_assetContract, _seller, _listingId, _listing) => {
          expect(_assetContract).to.equal(accessNft.address);
          expect(_seller).to.equal(creator.address);
          expect(_listingId).to.equal(listingId);

          expect(_listing.listingId).to.equal(listingId);
          expect(_listing.seller).to.equal(creator.address);
          expect(_listing.assetContract).to.equal(accessNft.address);
          expect(_listing.tokenId).to.equal(rewardId);
          expect(_listing.quantity).to.equal(amountOfTokenToList);
          expect(_listing.tokensPerBuyer).to.equal(tokensPerBuyer);
          expect(_listing.currency).to.equal(coin.address);
          expect(_listing.pricePerToken).to.equal(price);
          expect(_listing.tokenType).to.equal(0); // 0 == ERC1155 i.e. pack / NFTCollection / AccessNFT

          resolve(null);
        });

        setTimeout(() => {
          reject(new Error("Timeout: NewListing"));
        }, 10000);
      });

      await sendGaslessTx(creator, forwarder, relayer, {
        from: creator.address,
        to: market.address,
        data: market.interface.encodeFunctionData("list", [
          accessNft.address,
          rewardId,
          coin.address,
          price,
          amountOfTokenToList,
          tokensPerBuyer,
          openStartAndEnd,
          openStartAndEnd,
        ]),
      });

      await eventPromise;
    });
  });

  describe("Balances", function () {
    beforeEach(async () => {
      // Approve Market to transfer tokens
      await sendGaslessTx(creator, forwarder, relayer, {
        from: creator.address,
        to: accessNft.address,
        data: accessNft.interface.encodeFunctionData("setApprovalForAll", [market.address, true]),
      });

      // List tokens
      await sendGaslessTx(creator, forwarder, relayer, {
        from: creator.address,
        to: market.address,
        data: market.interface.encodeFunctionData("list", [
          accessNft.address,
          rewardId,
          coin.address,
          price,
          amountOfTokenToList,
          tokensPerBuyer,
          openStartAndEnd,
          openStartAndEnd,
        ]),
      });
    });

    it("Should transfer all tokens from seller to Market", async () => {
      expect(await accessNft.balanceOf(creator.address, rewardId)).to.equal(
        BigNumber.from(rewardSupplies[0]).sub(amountOfTokenToList),
      );

      expect(await accessNft.balanceOf(market.address, rewardId)).to.equal(amountOfTokenToList);
    });
  });

  describe("Contract state", function () {
    let listingId: BigNumber;

    beforeEach(async () => {
      // Approve Market to transfer tokens
      await sendGaslessTx(creator, forwarder, relayer, {
        from: creator.address,
        to: accessNft.address,
        data: accessNft.interface.encodeFunctionData("setApprovalForAll", [market.address, true]),
      });

      // Get listing ID
      listingId = await market.totalListings();

      // List tokens
      await sendGaslessTx(creator, forwarder, relayer, {
        from: creator.address,
        to: market.address,
        data: market.interface.encodeFunctionData("list", [
          accessNft.address,
          rewardId,
          coin.address,
          price,
          amountOfTokenToList,
          tokensPerBuyer,
          openStartAndEnd,
          openStartAndEnd,
        ]),
      });
    });

    it("Should increment the number of total listings on the market", async () => {
      expect(await market.totalListings()).to.equal(listingId.add(1));
    });

    it("Should store the state of the listing created", async () => {
      const listing = await market.listings(listingId);

      expect(listing.listingId).to.equal(listingId);
      expect(listing.seller).to.equal(creator.address);
      expect(listing.assetContract).to.equal(accessNft.address);
      expect(listing.tokenId).to.equal(rewardId);
      expect(listing.quantity).to.equal(amountOfTokenToList);
      expect(listing.currency).to.equal(coin.address);
      expect(listing.pricePerToken).to.equal(price);
      expect(listing.tokenType).to.equal(0); // 0 == ERC1155 i.e. pack / NFTCollection / AccessNFT
    });
  });

  describe("Roles", function () {
    beforeEach(async () => {
      // Approve Market to transfer tokens
      await sendGaslessTx(creator, forwarder, relayer, {
        from: creator.address,
        to: accessNft.address,
        data: accessNft.interface.encodeFunctionData("setApprovalForAll", [market.address, true]),
      });
    });

    it("Should not revert if seller does not have lister role and listing is not restricted", async () => {
      await expect(
        sendGaslessTx(creator, forwarder, relayer, {
          from: creator.address,
          to: market.address,
          data: market.interface.encodeFunctionData("list", [
            accessNft.address,
            rewardId,
            coin.address,
            price,
            amountOfTokenToList,
            tokensPerBuyer,
            openStartAndEnd,
            openStartAndEnd,
          ]),
        }),
      ).to.not.reverted;
    });

    it("Should revert if seller does not have lister role and listing is restricted", async () => {
      await market.setRestrictedListerRoleOnly(true);
      await expect(
        sendGaslessTx(creator, forwarder, relayer, {
          from: creator.address,
          to: market.address,
          data: market.interface.encodeFunctionData("list", [
            accessNft.address,
            rewardId,
            coin.address,
            price,
            amountOfTokenToList,
            tokensPerBuyer,
            openStartAndEnd,
            openStartAndEnd,
          ]),
        }),
      ).to.reverted;
    });

    it("Should not revert if seller has lister role and listing is restricted", async () => {
      await market.setRestrictedListerRoleOnly(true);
      await market.grantRole(await market.LISTER_ROLE(), creator.address);
      await expect(
        sendGaslessTx(creator, forwarder, relayer, {
          from: creator.address,
          to: market.address,
          data: market.interface.encodeFunctionData("list", [
            accessNft.address,
            rewardId,
            coin.address,
            price,
            amountOfTokenToList,
            tokensPerBuyer,
            openStartAndEnd,
            openStartAndEnd,
          ]),
        }),
      ).to.not.reverted;
    });

    it("Should not revert if seller has lister role and listing is not restricted", async () => {
      await market.setRestrictedListerRoleOnly(false);
      await market.grantRole(await market.LISTER_ROLE(), creator.address);
      await expect(
        sendGaslessTx(creator, forwarder, relayer, {
          from: creator.address,
          to: market.address,
          data: market.interface.encodeFunctionData("list", [
            accessNft.address,
            rewardId,
            coin.address,
            price,
            amountOfTokenToList,
            tokensPerBuyer,
            openStartAndEnd,
            openStartAndEnd,
          ]),
        }),
      ).to.not.reverted;
    });
  });
});
