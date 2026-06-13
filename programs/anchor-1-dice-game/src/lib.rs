pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("GWWbCt4NwKodxf3cBoovo9bjdXNjhMnWifKczX8KbkLJ");

#[program]
pub mod anchor_1_dice_game {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, amount: u64) -> Result<()> {
        ctx.accounts.init(amount)
    }

    pub fn place_bet(ctx: Context<PlaceBet>, seed:u128, roll: u8, amount: u64) -> Result<()> {
        ctx.accounts.create_bet(&ctx.bumps, seed, roll, amount)?;
        ctx.accounts.deposit(amount)
    }

    /// Submits the resolved roll for a bet. This instruction must be placed
    /// immediately before `resolve_bet` in the same transaction - `resolve_bet`
    /// uses instruction introspection to read the `roll` value from here.
    pub fn submit_roll(ctx: Context<SubmitRoll>, roll: u8) -> Result<()> {
        ctx.accounts.submit_roll(roll)
    }

    /// Resolves a bet using the `roll` value submitted via the preceding
    /// `submit_roll` instruction in the same transaction (verified through
    /// instruction introspection).
    ///
    /// Example: if the player chose `roll = 50`, they win on resolved rolls 1 through 49.
    /// Lower target rolls are harder to hit, so they pay a larger multiplier after the house edge.
    pub fn resolve_bet(ctx: Context<ResolveBet>) -> Result<()> {
        let roll = ctx.accounts.verify_roll_submission()?;
        ctx.accounts.resolve_bet(&ctx.bumps, roll)
    }

    pub fn refund_bet(ctx: Context<RefundBet>) -> Result<()> {
        ctx.accounts.refund_bet(&ctx.bumps)
    }
}
