use anchor_lang::prelude::*;

declare_id!("F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe");

#[program]
pub mod bursar_solana {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
