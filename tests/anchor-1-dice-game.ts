import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Anchor1DiceGame } from "../target/types/anchor_1_dice_game";
import {
    Transaction,
    Ed25519Program,
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL,
    SYSVAR_INSTRUCTIONS_PUBKEY,
    sendAndConfirmTransaction
} from "@solana/web3.js";
import { createHash, randomBytes} from "crypto";
import { BN } from "bn.js";

const BET_ROLL = 50;
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

    const seed = new BN(randomBytes(16));
    const vault = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), house.publicKey.toBuffer()],
        program.programId
    )[0];

    const bet = PublicKey.findProgramAddressSync(
        [
            Buffer.from("bet"),
            vault.toBuffer(),
            player.publicKey.toBuffer(),
            seed.toBuffer("le", 16),
        ],
        program.programId
    )[0];

    it("Airdrop", async () => {
        await Promise.all(
            [house, player].map(async (key) => {
                return await anchor.getProvider()
                                   .connection.requestAirdrop(
                                    key.publicKey,
                                    2 * anchor.web3.LAMPORTS_PER_SOL
                                   )
                                   .then(confirmTx);
            }),
        );
    });

    it("Initialize", async () => {
        await program.methods
            .initialize(new BN(100 * LAMPORTS_PER_SOL))
            .accountsStrict({
                house: house.publicKey,
                vault,
                systemProgam: SystemProgram.programId,
            })
            .signers([house])
            .rpc()
            .then(confirmTx);
    });

    it("Place a bet", async () => {
        await program.methods
            .placeBet(seed, BET_ROLL, new BN(BET_AMOUNT.toString()))
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
    });

    it("Resolve a bet", async () => {
        //Pull the bet Pda
        const betPda = await anchor.getProvider().connection.getAccountInfo(bet, "confirmed");
        if(!betPda) {
            throw new Error("Bet account not found");
        }
        
        const sig_ix = Ed25519Program.createInstructionWithPrivateKey({
            privateKey: house.secretKey,
            message: betPda.data.subarray(8)
        });

        // The Ed25519 instruction data is packed like this for one signature:
        // [0..16]: header with offsets, [16..48]: public key,
        // [48..112]: signature, [112..end]: signed message.
        // The on-chain program receives only the 64-bytes signature here, then
        // reads this full Ed25519 instruction from the instructions sysvar.

        const ed25519Signature = Buffer.from(
            sig_ix.data.subarray(16 + 32, 16 + 32 +64),
        );

        const resolve_ix = await program.methods
            .resolveBet(ed25519Signature)
            .accountsStrict({
                player: player.publicKey,
                house: house.publicKey,
                vault,
                bet,
                instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
                systemProgram: SystemProgram.programId,
            })
            .signers([house])
            .instruction();

        const tx = new Transaction().add(sig_ix).add(resolve_ix);

        try {
            await sendAndConfirmTransaction(program.provider.connection, tx, [house]);
            logBetSummary("web3.js", BET_ROLL, BET_AMOUNT, ed25519Signature);
        } catch (error) {
            console.error(error);
            throw error;
        }
    });
});

