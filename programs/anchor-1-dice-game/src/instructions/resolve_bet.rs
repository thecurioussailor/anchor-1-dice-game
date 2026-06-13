use anchor_lang::{prelude::*, system_program::{Transfer, transfer}};

use solana_instructions_sysvar::load_instruction_at_checked;

use crate::{
    error::DiceError,
    state::{
        Bet,
        HOUSE_EDGE_BASIS_POINTS
    }
};

/// Anchor instruction discriminator for `submit_roll`, i.e. the first 8 bytes
/// of sha256("global:submit_roll").
const SUBMIT_ROLL_DISCRIMINATOR: [u8; 8] = [226, 130, 208, 66, 181, 199, 113, 28];

#[derive(Accounts)]
pub struct ResolveBet<'info> {
    #[account(mut)]
    pub house: Signer<'info>,

    /// CHECK: Player account is validated via has_one constraint on the bet PDA and receives lamports only
    #[account(mut)]
    pub player: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"vault", house.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,

    #[account(
        mut,
        has_one = player,
        close = player,
        seeds = [b"bet", vault.key().as_ref(), player.key().as_ref(), bet.seed.to_le_bytes().as_ref()],
        bump = bet.bump
    )]
    pub bet: Account<'info, Bet>,

    /// CHECK: Validated by address constraint against the known instructions sysvar ID
    #[account(
        address = solana_sdk_ids::sysvar::instructions::ID
    )]
    pub instruction_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> ResolveBet<'info> {
    /// Reads the `submit_roll` instruction that must appear at index 0 of this
    /// transaction (instruction introspection) and returns the roll value it
    /// carries, after verifying it was signed by the house and targets this bet.
    pub fn verify_roll_submission(&self) -> Result<u8> {
        let ix = load_instruction_at_checked(0, &self.instruction_sysvar.to_account_info())?;

        require_keys_eq!(
            ix.program_id,
            crate::ID,
            DiceError::InvalidIntrospectedProgram
        );

        require!(
            ix.data.len() == 9 && ix.data[0..8] == SUBMIT_ROLL_DISCRIMINATOR,
            DiceError::InvalidIntrospectedInstruction
        );

        require!(ix.accounts.len() == 2, DiceError::InvalidIntrospectedInstruction);

        require_keys_eq!(
            ix.accounts[0].pubkey,
            self.house.key(),
            DiceError::InvalidRollSigner
        );
        require!(ix.accounts[0].is_signer, DiceError::InvalidRollSigner);

        require_keys_eq!(
            ix.accounts[1].pubkey,
            self.bet.key(),
            DiceError::BetMismatch
        );

        let roll = ix.data[8];
        require!(roll >= 1 && roll <= 100, DiceError::InvalidRollValue);

        Ok(roll)
    }

    pub fn resolve_bet(&mut self, bumps: &ResolveBetBumps, roll: u8) -> Result<()> {
        if self.bet.roll > roll {
            let winning_numbers = self.bet.roll as u128 - 1;
            let payout = (self.bet.amount as u128)
                .checked_mul(10_000 - HOUSE_EDGE_BASIS_POINTS as u128)
                .ok_or(DiceError::Overflow)?
                .checked_div(winning_numbers)
                .ok_or(DiceError::Overflow)?
                .checked_div(100)
                .ok_or(DiceError::Overflow)?;

            let payout = u64::try_from(payout).map_err(|_| DiceError::Overflow)?;

            let signer_seeds: &[&[&[u8]]] =
                &[&[b"vault", &self.house.key().to_bytes(), &[bumps.vault]]];

            let accounts = Transfer {
                from: self.vault.to_account_info(),
                to: self.player.to_account_info(),
            };

            let ctx = CpiContext::new_with_signer(
                self.system_program.key(),
                accounts,
                signer_seeds
            );

            transfer(ctx, payout)?
        };

        Ok(())
    }
}
