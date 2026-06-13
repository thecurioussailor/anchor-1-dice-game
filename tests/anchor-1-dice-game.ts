import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Anchor1DiceGame } from "../target/types/anchor_1_dice_game";
import {
    Transaction,
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL,
    SYSVAR_INSTRUCTIONS_PUBKEY,
    sendAndConfirmTransaction
} from "@solana/web3.js";
import { randomBytes } from "crypto";
import { BN } from "bn.js";
import { assert } from "chai";

const BET_AMOUNT = BigInt(LAMPORTS_PER_SOL / 100);
const HOUSE_EDGE_BASIS_POINTS = 150n; // 1.5%

describe("dice-game", () => {
    anchor.setProvider(anchor.AnchorProvider.env());

    const confirmTx = async (signature: string) => {
        const latestBlockhash = await anchor.getProvider().connection.getLatestBlockhash();
        await anchor.getProvider().connection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
        return signature;
    };

    const program = anchor.workspace.Anchor1DiceGame as Program<Anchor1DiceGame>;

    const house = Keypair.generate();
    const player = Keypair.generate();

    const vault = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), house.publicKey.toBuffer()],
        program.programId
    )[0];

    const betPda = (seed: InstanceType<typeof BN>) =>
        PublicKey.findProgramAddressSync(
            [
                Buffer.from("bet"),
                vault.toBuffer(),
                player.publicKey.toBuffer(),
                seed.toBuffer("le", 16),
            ],
            program.programId
        )[0];

    // Sends [submit_roll(roll), resolve_bet] as a single transaction, signed by house.
    // resolve_bet introspects the submit_roll instruction at index 0 to read `roll`.
    const resolveBet = async (bet: PublicKey, roll: number) => {
        const submitRollIx = await program.methods
            .submitRoll(roll)
            .accountsStrict({
                house: house.publicKey,
                bet,
            })
            .instruction();

        const resolveBetIx = await program.methods
            .resolveBet()
            .accountsStrict({
                house: house.publicKey,
                player: player.publicKey,
                vault,
                bet,
                instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
                systemProgram: SystemProgram.programId,
            })
            .instruction();

        const { blockhash, lastValidBlockHeight } = await program.provider.connection.getLatestBlockhash();
        const tx = new Transaction({
            feePayer: house.publicKey,
            blockhash,
            lastValidBlockHeight,
        }).add(submitRollIx).add(resolveBetIx);

        return sendAndConfirmTransaction(program.provider.connection, tx, [house]);
    };

    before(async () => {
        await Promise.all(
            [house, player].map(async (key) => {
                return await anchor.getProvider()
                                   .connection.requestAirdrop(
                                    key.publicKey,
                                    10 * anchor.web3.LAMPORTS_PER_SOL
                                   )
                                   .then(confirmTx);
            }),
        );

        await program.methods
            .initialize(new BN(2 * LAMPORTS_PER_SOL))
            .accountsStrict({
                house: house.publicKey,
                vault,
                systemProgram: SystemProgram.programId,
            })
            .signers([house])
            .rpc()
            .then(confirmTx);
    });

    it("Places a bet", async () => {
        const seed = new BN(randomBytes(16));
        const bet = betPda(seed);

        await program.methods
            .placeBet(seed, 50, new BN(BET_AMOUNT.toString()))
            .accountsStrict({
                player: player.publicKey,
                house: house.publicKey,
                vault,
                bet,
                systemProgram: SystemProgram.programId
            })
            .signers([player])
            .rpc()
            .then(confirmTx);

        const betAccount = await program.account.bet.fetch(bet);
        assert.equal(betAccount.roll, 50);
        assert.equal(betAccount.amount.toString(), BET_AMOUNT.toString());
        assert.ok(betAccount.player.equals(player.publicKey));
    });

    it("Resolves a winning bet and pays out the player", async () => {
        const seed = new BN(randomBytes(16));
        const bet = betPda(seed);

        await program.methods
            .placeBet(seed, 50, new BN(BET_AMOUNT.toString()))
            .accountsStrict({
                player: player.publicKey,
                house: house.publicKey,
                vault,
                bet,
                systemProgram: SystemProgram.programId
            })
            .signers([player])
            .rpc()
            .then(confirmTx);

        const betRentLamports = BigInt(
            (await program.provider.connection.getAccountInfo(bet)).lamports
        );

        const balanceBefore = await program.provider.connection.getBalance(player.publicKey);

        // roll = 40 < bet.roll (50) => player wins
        await resolveBet(bet, 40);

        const balanceAfter = await program.provider.connection.getBalance(player.publicKey);

        const winningNumbers = BigInt(50 - 1);
        const expectedPayout = (BET_AMOUNT * (10_000n - HOUSE_EDGE_BASIS_POINTS)) / winningNumbers / 100n;
        // Closing the bet account also refunds its rent to the player.
        const expectedDelta = expectedPayout + betRentLamports;

        assert.equal(BigInt(balanceAfter - balanceBefore).toString(), expectedDelta.toString());

        // bet account should be closed
        const closed = await program.provider.connection.getAccountInfo(bet);
        assert.isNull(closed);
    });

    it("Resolves a losing bet without paying out", async () => {
        const seed = new BN(randomBytes(16));
        const bet = betPda(seed);

        await program.methods
            .placeBet(seed, 50, new BN(BET_AMOUNT.toString()))
            .accountsStrict({
                player: player.publicKey,
                house: house.publicKey,
                vault,
                bet,
                systemProgram: SystemProgram.programId
            })
            .signers([player])
            .rpc()
            .then(confirmTx);

        const betRentLamports = BigInt(
            (await program.provider.connection.getAccountInfo(bet)).lamports
        );

        const balanceBefore = await program.provider.connection.getBalance(player.publicKey);

        // roll = 60 >= bet.roll (50) => player loses, no payout
        await resolveBet(bet, 60);

        const balanceAfter = await program.provider.connection.getBalance(player.publicKey);

        // No payout, but the bet account's rent is still refunded on close.
        assert.equal(BigInt(balanceAfter - balanceBefore).toString(), betRentLamports.toString());

        const closed = await program.provider.connection.getAccountInfo(bet);
        assert.isNull(closed);
    });

    it("Rejects resolve_bet when submit_roll is signed by someone other than house", async () => {
        const seed = new BN(randomBytes(16));
        const bet = betPda(seed);

        await program.methods
            .placeBet(seed, 50, new BN(BET_AMOUNT.toString()))
            .accountsStrict({
                player: player.publicKey,
                house: house.publicKey,
                vault,
                bet,
                systemProgram: SystemProgram.programId
            })
            .signers([player])
            .rpc()
            .then(confirmTx);

        const submitRollIx = await program.methods
            .submitRoll(40)
            .accountsStrict({
                house: player.publicKey, // not the house
                bet,
            })
            .instruction();

        const resolveBetIx = await program.methods
            .resolveBet()
            .accountsStrict({
                house: house.publicKey,
                player: player.publicKey,
                vault,
                bet,
                instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
                systemProgram: SystemProgram.programId,
            })
            .instruction();

        const { blockhash, lastValidBlockHeight } = await program.provider.connection.getLatestBlockhash();
        const tx = new Transaction({
            feePayer: house.publicKey,
            blockhash,
            lastValidBlockHeight,
        }).add(submitRollIx).add(resolveBetIx);

        try {
            await sendAndConfirmTransaction(program.provider.connection, tx, [house, player]);
            assert.fail("expected resolve_bet to fail");
        } catch (error) {
            assert.include(JSON.stringify(error), "InvalidRollSigner");
        }
    });

    it("Refunds a bet after the timeout", async () => {
        const seed = new BN(randomBytes(16));
        const bet = betPda(seed);

        await program.methods
            .placeBet(seed, 50, new BN(BET_AMOUNT.toString()))
            .accountsStrict({
                player: player.publicKey,
                house: house.publicKey,
                vault,
                bet,
                systemProgram: SystemProgram.programId
            })
            .signers([player])
            .rpc()
            .then(confirmTx);

        try {
            await program.methods
                .refundBet()
                .accountsStrict({
                    player: player.publicKey,
                    house: house.publicKey,
                    vault,
                    bet,
                    systemProgram: SystemProgram.programId,
                })
                .signers([player])
                .rpc()
                .then(confirmTx);

            assert.fail("expected refund_bet to fail before the timeout");
        } catch (error) {
            assert.include(JSON.stringify(error), "TimeoutNotReached");
        }
    });
});
