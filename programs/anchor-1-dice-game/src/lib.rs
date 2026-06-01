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

    //place_bet
    //resolve_bet
    //refund_bet
}
