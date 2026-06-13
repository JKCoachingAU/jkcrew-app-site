create or replace function public.jkcrew_country_timezone(p_country_code text)
returns text
language sql
stable
set search_path = public
as $$
  select case upper(coalesce(nullif(trim(p_country_code), ''), 'AU'))
    when 'AU' then 'Australia/Brisbane'
    when 'DE' then 'Europe/Berlin'
    when 'RU' then 'Europe/Moscow'
    when 'NZ' then 'Pacific/Auckland'
    when 'US' then 'America/Los_Angeles'
    when 'CA' then 'America/Toronto'
    when 'GB' then 'Europe/London'
    when 'UK' then 'Europe/London'
    when 'FR' then 'Europe/Paris'
    when 'ES' then 'Europe/Madrid'
    when 'IT' then 'Europe/Rome'
    when 'NL' then 'Europe/Amsterdam'
    when 'BE' then 'Europe/Brussels'
    when 'CH' then 'Europe/Zurich'
    when 'JP' then 'Asia/Tokyo'
    when 'BR' then 'America/Sao_Paulo'
    when 'CO' then 'America/Bogota'
    when 'AR' then 'America/Argentina/Buenos_Aires'
    when 'CL' then 'America/Santiago'
    when 'ZA' then 'Africa/Johannesburg'
    when 'SG' then 'Asia/Singapore'
    when 'MY' then 'Asia/Kuala_Lumpur'
    when 'TH' then 'Asia/Bangkok'
    when 'ID' then 'Asia/Jakarta'
    when 'PH' then 'Asia/Manila'
    else 'Australia/Brisbane'
  end;
$$;

grant execute on function public.jkcrew_country_timezone(text) to authenticated;
