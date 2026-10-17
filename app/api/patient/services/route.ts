import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/server/supabase-admin";

export async function GET() {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "The patient directory is not configured." }, { status: 503 });
  }

  const { data: services, error: servicesError } = await admin
    .from("hospital_services")
    .select("id,service_code,name,description,department,hospital_id")
    .eq("is_published", true)
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .limit(300);

  if (servicesError) {
    return NextResponse.json({ error: "Unable to load hospital services." }, { status: 500 });
  }
  if (!services?.length) return NextResponse.json({ services: [] });

  const hospitalIds = [...new Set(services.map(service => service.hospital_id))];
  const { data: hospitals, error: hospitalsError } = await admin
    .from("hospitals")
    .select("id,name,city,country,status")
    .in("id", hospitalIds)
    .eq("status", "active");

  if (hospitalsError) {
    return NextResponse.json({ error: "Unable to load the hospital directory." }, { status: 500 });
  }

  const hospitalById = new Map((hospitals ?? []).map(hospital => [hospital.id, hospital]));
  const publishedServices = services
    .filter(service => hospitalById.has(service.hospital_id))
    .map(service => ({
      id: service.id,
      serviceCode: service.service_code,
      name: service.name,
      description: service.description,
      department: service.department,
      hospital: hospitalById.get(service.hospital_id),
    }));

  return NextResponse.json({ services: publishedServices });
}
