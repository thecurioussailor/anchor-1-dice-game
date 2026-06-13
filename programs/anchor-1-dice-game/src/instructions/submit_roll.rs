use anchor_lang::prelude::*;

use crate::state::Bet;

#[derive(Accounts)]
pub struct SubmitRoll<'info> {
    pub house: Signer<'info>,

    pub bet: Account<'info, Bet>,
}

impl<'info> SubmitRoll<'info> {
    pub fn submit_roll(&mut self, _roll: u8) -> Result<()> {
        Ok(())
    }
}
