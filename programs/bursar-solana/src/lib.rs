//! Bursar on Solana: spending rules for teams and their AI agents.
//!
//! A team keeps USDC in a vault owned by its PDA. Every person and every agent on the team pays
//! under a policy this program enforces. `pay` takes a registered service, never an address.
//! Inside the policy the payment settles in the same transaction. Over a limit it is filed as a
//! pending payment, and only the owner can approve it. An approval waives a budget, never a stop.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe");

pub const MAX_SERVICES: usize = 8;
pub const LABEL_MAX: usize = 32;
pub const MEMO_MAX: usize = 64;
pub const INTENT_MAX: usize = 32;
pub const SERVICE_ID_MAX: usize = 32;
pub const MIN_PERIOD_SECS: u32 = 60;
/// A pending payment can be approved for one day after it is filed.
pub const PENDING_TTL_SECS: i64 = 24 * 60 * 60;

/// Reasons a payment went to the owner, as bits in `Payment::reasons`.
pub const OVER_SERVICE: u8 = 1;
pub const OVER_CAP: u8 = 2;
pub const OVER_ALLOWANCE: u8 = 4;
pub const OVER_COUNT: u8 = 8;

#[program]
pub mod bursar_solana {
    use super::*;

    // ------------------------------------------------------------------ registry ---

    /// One registry per deployment: who may list services, and which token teams hold.
    pub fn init_config(ctx: Context<InitConfig>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.mint = ctx.accounts.mint.key();
        c.services = 0;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Lists a service a team can pay. `price` is the list price shown to agents; it is not a limit.
    pub fn register_service(
        ctx: Context<RegisterService>,
        id: String,
        label: String,
        price: u64,
    ) -> Result<()> {
        check_service_id(&id)?;
        check_label(&label)?;
        let s = &mut ctx.accounts.service;
        s.id = id;
        s.label = label;
        s.payee = ctx.accounts.payee_token.owner;
        s.payee_token = ctx.accounts.payee_token.key();
        s.price = price;
        s.active = true;
        s.bump = ctx.bumps.service;
        ctx.accounts.config.services += 1;
        Ok(())
    }

    /// Suspends or restores a service. A suspended service cannot be paid or settled.
    pub fn set_service_active(ctx: Context<AdminService>, active: bool) -> Result<()> {
        ctx.accounts.service.active = active;
        Ok(())
    }

    // --------------------------------------------------------------------- teams ---

    pub fn create_team(ctx: Context<CreateTeam>, name: String) -> Result<()> {
        check_label(&name)?;
        let t = &mut ctx.accounts.team;
        t.owner = ctx.accounts.owner.key();
        t.mint = ctx.accounts.mint.key();
        t.vault = ctx.accounts.vault.key();
        t.name = name;
        t.paused = false;
        t.spenders = 0;
        t.payments = 0;
        t.paid_count = 0;
        t.paid_total = 0;
        t.created_at = Clock::get()?.unix_timestamp;
        t.bump = ctx.bumps.team;
        Ok(())
    }

    pub fn set_paused(ctx: Context<OwnerTeam>, paused: bool) -> Result<()> {
        ctx.accounts.team.paused = paused;
        Ok(())
    }

    /// Moves money out of the vault to an account the owner names. Only the owner can.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, BursarError::ZeroAmount);
        let team = &ctx.accounts.team;
        transfer_from_vault(
            team,
            &ctx.accounts.vault,
            &ctx.accounts.to,
            &ctx.accounts.token_program,
            amount,
        )
    }

    // ------------------------------------------------------------------ spenders ---

    /// Grants a person or an agent a policy. A revoked spender can be granted again, with a new
    /// generation, so nothing it filed before the revoke can settle.
    pub fn add_spender(
        ctx: Context<AddSpender>,
        authority: Pubkey,
        kind: Kind,
        label: String,
        policy: Policy,
        services: Vec<Pubkey>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        check_label(&label)?;
        check_policy(&policy, now)?;
        let services = clean_services(services)?;
        let sp = &mut ctx.accounts.spender;
        let generation = if sp.team == Pubkey::default() {
            ctx.accounts.team.spenders += 1;
            0
        } else {
            require!(sp.status == Status::Revoked, BursarError::AlreadySpender);
            require!(sp.kind == kind, BursarError::KindChanged);
            sp.generation + 1
        };
        sp.team = ctx.accounts.team.key();
        sp.authority = authority;
        sp.kind = kind;
        sp.label = label;
        sp.status = Status::Active;
        sp.generation = generation;
        sp.policy = policy;
        sp.services = services;
        sp.period_start = now;
        sp.spent = 0;
        sp.count = 0;
        sp.added_at = now;
        sp.bump = ctx.bumps.spender;
        Ok(())
    }

    pub fn set_policy(ctx: Context<OwnerSpender>, policy: Policy) -> Result<()> {
        check_policy(&policy, Clock::get()?.unix_timestamp)?;
        let sp = &mut ctx.accounts.spender;
        require!(sp.status != Status::Revoked, BursarError::NotActive);
        sp.policy = policy;
        Ok(())
    }

    pub fn set_services(ctx: Context<OwnerSpender>, services: Vec<Pubkey>) -> Result<()> {
        let services = clean_services(services)?;
        let sp = &mut ctx.accounts.spender;
        require!(sp.status != Status::Revoked, BursarError::NotActive);
        sp.services = services;
        Ok(())
    }

    /// Pauses or resumes a spender. Revoking is its own call because it cannot be undone.
    pub fn set_spender_status(ctx: Context<OwnerSpender>, active: bool) -> Result<()> {
        let sp = &mut ctx.accounts.spender;
        require!(sp.status != Status::Revoked, BursarError::NotActive);
        sp.status = if active { Status::Active } else { Status::Paused };
        Ok(())
    }

    pub fn revoke(ctx: Context<OwnerSpender>) -> Result<()> {
        ctx.accounts.spender.status = Status::Revoked;
        Ok(())
    }

    // -------------------------------------------------------------------- paying ---

    /// Pays a registered service from the vault under the signer's policy.
    ///
    /// `payer` covers the fee and the payment record's rent, so the spender never needs SOL.
    /// The payment record's address is derived from (spender, intent), so one intent can be
    /// paid or filed at most once.
    pub fn pay(ctx: Context<Pay>, intent: String, amount: u64, memo: String) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        check_intent(&intent)?;
        require!(memo.len() <= MEMO_MAX, BursarError::MemoTooLong);
        require!(amount > 0, BursarError::ZeroAmount);

        let team = &mut ctx.accounts.team;
        let sp = &mut ctx.accounts.spender;
        let service = &ctx.accounts.service;
        require!(!team.paused, BursarError::TeamPaused);
        require!(sp.status == Status::Active, BursarError::NotActive);
        require!(now < sp.policy.expires_at, BursarError::Expired);
        require!(service.active, BursarError::ServiceSuspended);

        roll(sp, now);
        let reasons = over_limits(sp, &service.key(), amount);

        let p = &mut ctx.accounts.payment;
        p.team = team.key();
        p.spender = sp.key();
        p.authority = sp.authority;
        p.kind = sp.kind;
        p.service = service.key();
        p.payee_token = service.payee_token;
        p.amount = amount;
        p.intent = intent;
        p.memo = memo;
        p.generation = sp.generation;
        p.reasons = reasons;
        p.created_at = now;
        p.decided_at = 0;
        p.number = team.payments;
        p.bump = ctx.bumps.payment;
        team.payments += 1;

        if reasons == 0 {
            sp.spent += amount;
            sp.count += 1;
            p.status = PaymentStatus::Paid;
            p.deadline = 0;
            team.paid_count += 1;
            team.paid_total += amount;
            transfer_from_vault(
                team,
                &ctx.accounts.vault,
                &ctx.accounts.payee_token,
                &ctx.accounts.token_program,
                amount,
            )?;
            msg!("bursar: paid {} to {}", amount, service.id);
        } else {
            p.status = PaymentStatus::Pending;
            p.deadline = now + PENDING_TTL_SECS;
            msg!("bursar: filed {} for {} reasons={}", amount, service.id, reasons);
        }
        Ok(())
    }

    /// The owner approves a pending payment and it settles in the same transaction.
    /// A stop that applies now (revoked, expired, service suspended or moved) refuses it for good.
    pub fn approve(ctx: Context<Approve>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let team = &mut ctx.accounts.team;
        let sp = &mut ctx.accounts.spender;
        let service = &ctx.accounts.service;
        let p = &mut ctx.accounts.payment;
        require!(!team.paused, BursarError::TeamPaused);
        require!(p.status == PaymentStatus::Pending, BursarError::NotPending);
        require!(now < p.deadline, BursarError::RequestExpired);

        p.decided_at = now;
        let stopped = sp.status != Status::Active
            || sp.generation != p.generation
            || now >= sp.policy.expires_at
            || !service.active
            || service.payee_token != p.payee_token;
        if stopped {
            p.status = PaymentStatus::Refused;
            msg!("bursar: refused at approval");
            return Ok(());
        }

        // The money is leaving, so it counts against the period even past the limits.
        roll(sp, now);
        sp.spent = sp.spent.saturating_add(p.amount);
        sp.count = sp.count.saturating_add(1);
        p.status = PaymentStatus::Settled;
        team.paid_count += 1;
        team.paid_total += p.amount;
        let amount = p.amount;
        transfer_from_vault(
            team,
            &ctx.accounts.vault,
            &ctx.accounts.payee_token,
            &ctx.accounts.token_program,
            amount,
        )?;
        msg!("bursar: approved and settled {}", amount);
        Ok(())
    }

    pub fn decline(ctx: Context<Decline>) -> Result<()> {
        let p = &mut ctx.accounts.payment;
        require!(p.status == PaymentStatus::Pending, BursarError::NotPending);
        p.status = PaymentStatus::Declined;
        p.decided_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// The owner, or the spender who filed it, withdraws a pending payment.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let signer = ctx.accounts.signer.key();
        let team = &ctx.accounts.team;
        let p = &mut ctx.accounts.payment;
        require!(
            signer == team.owner || signer == p.authority,
            BursarError::NotOwnerOrFiler
        );
        require!(p.status == PaymentStatus::Pending, BursarError::NotPending);
        p.status = PaymentStatus::Cancelled;
        p.decided_at = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

// ------------------------------------------------------------------------ helpers ---

fn transfer_from_vault<'info>(
    team: &Account<'info, Team>,
    vault: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[b"team", team.owner.as_ref(), &[team.bump]];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: vault.to_account_info(),
                to: to.to_account_info(),
                authority: team.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}

fn check_service_id(id: &str) -> Result<()> {
    require!(
        !id.is_empty()
            && id.len() <= SERVICE_ID_MAX
            && id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
        BursarError::BadServiceId
    );
    Ok(())
}

fn check_intent(intent: &str) -> Result<()> {
    require!(
        !intent.is_empty()
            && intent.len() <= INTENT_MAX
            && intent
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
        BursarError::BadIntent
    );
    Ok(())
}

fn check_label(label: &str) -> Result<()> {
    require!(
        !label.is_empty() && label.len() <= LABEL_MAX,
        BursarError::BadLabel
    );
    Ok(())
}

fn check_policy(p: &Policy, now: i64) -> Result<()> {
    require!(p.allowance > 0, BursarError::BadPolicy);
    require!(p.cap > 0 && p.cap <= p.allowance, BursarError::BadPolicy);
    require!(p.period_secs >= MIN_PERIOD_SECS, BursarError::BadPolicy);
    require!(p.max_payments >= 1, BursarError::BadPolicy);
    require!(p.expires_at > now, BursarError::BadPolicy);
    Ok(())
}

fn clean_services(services: Vec<Pubkey>) -> Result<Vec<Pubkey>> {
    require!(services.len() <= MAX_SERVICES, BursarError::TooManyServices);
    let mut out: Vec<Pubkey> = Vec::with_capacity(services.len());
    for s in services {
        if !out.contains(&s) {
            out.push(s);
        }
    }
    Ok(out)
}

/// Rolls the period forward to the latest scheduled boundary at or before `now`.
/// Periods roll on schedule from the grant, never to "now".
fn roll(sp: &mut Spender, now: i64) {
    let len = sp.policy.period_secs as i64;
    if now >= sp.period_start.saturating_add(len) {
        let periods = (now - sp.period_start) / len;
        sp.period_start += periods * len;
        sp.spent = 0;
        sp.count = 0;
    }
}

/// Which limits a payment would break, as bits. Zero means it is inside the policy.
fn over_limits(sp: &Spender, service: &Pubkey, amount: u64) -> u8 {
    let mut r = 0;
    if !sp.services.contains(service) {
        r |= OVER_SERVICE;
    }
    if amount > sp.policy.cap {
        r |= OVER_CAP;
    }
    if sp.spent.saturating_add(amount) > sp.policy.allowance {
        r |= OVER_ALLOWANCE;
    }
    if sp.count >= sp.policy.max_payments {
        r |= OVER_COUNT;
    }
    r
}

// ----------------------------------------------------------------------- accounts ---

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Kind {
    Person,
    Agent,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Status {
    Active,
    Paused,
    Revoked,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum PaymentStatus {
    /// Inside the policy; settled when filed.
    Paid,
    /// Over a limit; waiting for the owner.
    Pending,
    /// Approved by the owner and settled.
    Settled,
    Declined,
    Cancelled,
    /// A stop applied at approval. Final.
    Refused,
}

/// Amounts are token base units (USDC has 6 decimals). Times are unix seconds.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct Policy {
    /// What the spender may pay in one period.
    pub allowance: u64,
    pub period_secs: u32,
    /// The most one payment may be.
    pub cap: u64,
    /// The most payments in one period.
    pub max_payments: u32,
    /// The policy refuses from this instant on.
    pub expires_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub services: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Service {
    #[max_len(32)]
    pub id: String,
    #[max_len(32)]
    pub label: String,
    pub payee: Pubkey,
    pub payee_token: Pubkey,
    pub price: u64,
    pub active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Team {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    #[max_len(32)]
    pub name: String,
    pub paused: bool,
    pub spenders: u32,
    pub payments: u64,
    pub paid_count: u64,
    pub paid_total: u64,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Spender {
    pub team: Pubkey,
    pub authority: Pubkey,
    pub kind: Kind,
    #[max_len(32)]
    pub label: String,
    pub status: Status,
    pub generation: u32,
    pub policy: Policy,
    #[max_len(8)]
    pub services: Vec<Pubkey>,
    pub period_start: i64,
    pub spent: u64,
    pub count: u32,
    pub added_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Payment {
    pub team: Pubkey,
    /// The spender account (PDA).
    pub spender: Pubkey,
    /// The key that signed `pay`.
    pub authority: Pubkey,
    pub kind: Kind,
    pub service: Pubkey,
    /// The payee the registry named when the payment was filed. Only this account can be paid.
    pub payee_token: Pubkey,
    pub amount: u64,
    #[max_len(32)]
    pub intent: String,
    #[max_len(64)]
    pub memo: String,
    pub generation: u32,
    pub reasons: u8,
    pub status: PaymentStatus,
    pub created_at: i64,
    /// Pending payments can be approved until this time. Zero when paid at once.
    pub deadline: i64,
    pub decided_at: i64,
    /// Order within the team, from zero.
    pub number: u64,
    pub bump: u8,
}

// -------------------------------------------------------------------- instructions ---

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: String)]
pub struct RegisterService<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        space = 8 + Service::INIT_SPACE,
        seeds = [b"service", id.as_bytes()],
        bump
    )]
    pub service: Account<'info, Service>,
    #[account(token::mint = config.mint)]
    pub payee_token: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminService<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"service", service.id.as_bytes()], bump = service.bump)]
    pub service: Account<'info, Service>,
}

#[derive(Accounts)]
pub struct CreateTeam<'info> {
    /// Pays the rent for the team and its vault. Can be a sponsor.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = mint)]
    pub config: Account<'info, Config>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        space = 8 + Team::INIT_SPACE,
        seeds = [b"team", owner.key().as_ref()],
        bump
    )]
    pub team: Account<'info, Team>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = team
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerTeam<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"team", owner.key().as_ref()], bump = team.bump, has_one = owner)]
    pub team: Account<'info, Team>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"team", owner.key().as_ref()], bump = team.bump, has_one = owner, has_one = vault)]
    pub team: Account<'info, Team>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = team.mint)]
    pub to: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(authority: Pubkey)]
pub struct AddSpender<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"team", owner.key().as_ref()], bump = team.bump, has_one = owner)]
    pub team: Account<'info, Team>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Spender::INIT_SPACE,
        seeds = [b"spender", team.key().as_ref(), authority.as_ref()],
        bump
    )]
    pub spender: Account<'info, Spender>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerSpender<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"team", owner.key().as_ref()], bump = team.bump, has_one = owner)]
    pub team: Account<'info, Team>,
    #[account(
        mut,
        seeds = [b"spender", team.key().as_ref(), spender.authority.as_ref()],
        bump = spender.bump,
        has_one = team
    )]
    pub spender: Account<'info, Spender>,
}

#[derive(Accounts)]
#[instruction(intent: String)]
pub struct Pay<'info> {
    /// Pays the fee and the payment record's rent. A sponsor, so spenders never hold SOL.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// The person or agent paying. Holds no money of its own.
    pub authority: Signer<'info>,
    #[account(mut, has_one = vault)]
    pub team: Account<'info, Team>,
    #[account(
        mut,
        seeds = [b"spender", team.key().as_ref(), authority.key().as_ref()],
        bump = spender.bump,
        has_one = team,
        has_one = authority
    )]
    pub spender: Account<'info, Spender>,
    /// The registry entry. An unknown service id has no account, so the call fails here.
    #[account(seeds = [b"service", service.id.as_bytes()], bump = service.bump)]
    pub service: Account<'info, Service>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    /// Must be the payee the registry names. A made-up recipient cannot be passed.
    #[account(mut, address = service.payee_token @ BursarError::WrongPayee)]
    pub payee_token: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        space = 8 + Payment::INIT_SPACE,
        seeds = [b"payment", spender.key().as_ref(), intent.as_bytes()],
        bump
    )]
    pub payment: Account<'info, Payment>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Approve<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"team", owner.key().as_ref()],
        bump = team.bump,
        has_one = owner,
        has_one = vault
    )]
    pub team: Account<'info, Team>,
    #[account(mut, address = payment.spender, has_one = team)]
    pub spender: Account<'info, Spender>,
    #[account(address = payment.service)]
    pub service: Account<'info, Service>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, address = payment.payee_token @ BursarError::WrongPayee)]
    pub payee_token: Account<'info, TokenAccount>,
    #[account(mut, has_one = team)]
    pub payment: Account<'info, Payment>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Decline<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"team", owner.key().as_ref()], bump = team.bump, has_one = owner)]
    pub team: Account<'info, Team>,
    #[account(mut, has_one = team)]
    pub payment: Account<'info, Payment>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    pub signer: Signer<'info>,
    pub team: Account<'info, Team>,
    #[account(mut, has_one = team)]
    pub payment: Account<'info, Payment>,
}

// -------------------------------------------------------------------------- errors ---

#[error_code]
pub enum BursarError {
    #[msg("the team is paused")]
    TeamPaused,
    #[msg("spender is not active")]
    NotActive,
    #[msg("spender policy has expired")]
    Expired,
    #[msg("the service is suspended")]
    ServiceSuspended,
    #[msg("the payee is not the one the registry names")]
    WrongPayee,
    #[msg("payment is not pending")]
    NotPending,
    #[msg("the pending payment has expired")]
    RequestExpired,
    #[msg("only the owner or the filer can cancel")]
    NotOwnerOrFiler,
    #[msg("already a spender: change its policy instead")]
    AlreadySpender,
    #[msg("a spender keeps its kind")]
    KindChanged,
    #[msg("amount must be above zero")]
    ZeroAmount,
    #[msg("a memo is at most 64 bytes")]
    MemoTooLong,
    #[msg("an intent is 1 to 32 characters of a-z, A-Z, 0-9, - and _")]
    BadIntent,
    #[msg("a service id is 1 to 32 characters of a-z, 0-9 and -")]
    BadServiceId,
    #[msg("a label is 1 to 32 characters")]
    BadLabel,
    #[msg("allowance and cap above zero, cap within allowance, period at least 60 s, at least 1 payment, expiry in the future")]
    BadPolicy,
    #[msg("at most 8 services per spender")]
    TooManyServices,
}
