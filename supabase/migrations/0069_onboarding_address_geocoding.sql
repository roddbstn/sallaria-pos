-- 온보딩의 매장주소 단계가 이제 Settings의 "가게 배달정보"처럼 도로명주소+상세주소+geocoding까지
-- 받아오므로, complete_onboarding도 address_detail/lat/lng를 같이 저장하도록 확장.
-- p_address(도로명)는 기존처럼 clients.address/stores.address에도 계속 써서 하위호환 유지.
CREATE OR REPLACE FUNCTION complete_onboarding(
  p_store_id uuid,
  p_store_name text,
  p_owner_name text,
  p_address text,
  p_business_type text,
  p_customer_types text[],
  p_sources text[],
  p_source_other text,
  p_requested_plan text,
  p_address_detail text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_client_id uuid;
  v_store_id  uuid;
  v_source    text;
begin
  select id into v_client_id from clients where auth_user_id = auth.uid();
  if v_client_id is null then
    raise exception 'client not found for current user';
  end if;

  update clients set
    business_name = p_store_name,
    owner_name    = p_owner_name,
    address       = p_address,
    business_type = p_business_type,
    updated_at    = now()
  where id = v_client_id;

  if p_store_id is not null then
    update stores set
      name                  = p_store_name,
      address               = p_address,
      address_detail        = coalesce(p_address_detail, address_detail),
      lat                   = coalesce(p_lat, lat),
      lng                   = coalesce(p_lng, lng),
      representative_name   = p_owner_name,
      customer_types        = coalesce(p_customer_types, '{}'),
      onboarding_completed  = true,
      updated_at            = now()
    where id = p_store_id and client_id = v_client_id
    returning id into v_store_id;
  end if;

  if v_store_id is null then
    insert into stores (client_id, name, address, address_detail, lat, lng, representative_name, customer_types, onboarding_completed)
    values (v_client_id, p_store_name, p_address, p_address_detail, p_lat, p_lng, p_owner_name, coalesce(p_customer_types, '{}'), true)
    returning id into v_store_id;
  end if;

  delete from acquisition_sources where client_id = v_client_id;
  if p_sources is not null then
    foreach v_source in array p_sources loop
      insert into acquisition_sources (client_id, source) values (v_client_id, v_source);
    end loop;
  end if;
  if p_source_other is not null and length(trim(p_source_other)) > 0 then
    insert into acquisition_sources (client_id, source, other_text) values (v_client_id, '기타', p_source_other);
  end if;

  if p_requested_plan is not null and p_requested_plan <> 'free' then
    insert into plan_requests (client_id, requested_plan) values (v_client_id, p_requested_plan::plan_tier);
  end if;

  return v_store_id;
end;
$function$;
