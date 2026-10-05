import { PrismaClient, PartStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_SERVICES } from '../src/services/catalog.service';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 PapaTec - Sistema Loja - Seed iniciando...');

  // ---------------------------------------------------------------------------
  // 1. Administrador padrão
  // ---------------------------------------------------------------------------
  const adminEmail = 'admin@papatec.com';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        name: 'Administrador',
        email: adminEmail,
        password: await bcrypt.hash('admin123', 10),
        role: UserRole.ADMIN,
        active: true,
      },
    });
    console.log('✅ Admin criado: admin@papatec.com / admin123  (ALTERE A SENHA APÓS O 1º LOGIN)');
  }

  // ---------------------------------------------------------------------------
  // 2. Configurações padrão
  // ---------------------------------------------------------------------------
  const settings: { key: string; value: any; category: string }[] = [
    { key: 'company_name', value: 'PapaTec Assistência Técnica', category: 'COMPANY' },
    { key: 'company_phone', value: '(11) 99999-9999', category: 'COMPANY' },
    { key: 'company_email', value: 'contato@papatec.com', category: 'COMPANY' },
    { key: 'company_address', value: 'Rua Exemplo, 123 - Centro, São Paulo/SP', category: 'COMPANY' },
    { key: 'company_document', value: '', category: 'COMPANY' },
    { key: 'receipt_footer', value: 'Obrigado pela preferência!', category: 'COMPANY' },
    { key: 'default_labor_rate', value: 80, category: 'FINANCIAL' },
    { key: 'default_warranty_days', value: 90, category: 'FINANCIAL' },
    { key: 'budget_validity_days', value: 30, category: 'FINANCIAL' },
    { key: 'profit_margin_pct', value: 30, category: 'FINANCIAL' },
    { key: 'low_stock_threshold', value: 1, category: 'FINANCIAL' },
    { key: 'default_labor_hours', value: 1, category: 'LABOR' },
    { key: 'backup_path', value: '', category: 'BACKUP' },
    { key: 'backup_schedule', value: '0 12,18 * * *', category: 'BACKUP' },
    { key: 'backup_retention_days', value: 30, category: 'BACKUP' },
    { key: 'backup_include_uploads', value: true, category: 'BACKUP' },
    { key: 'allow_self_registration', value: false, category: 'SYSTEM' },
    { key: 'session_days', value: 7, category: 'SYSTEM' },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      create: setting,
      update: { value: setting.value, category: setting.category },
    });
  }
  console.log(`✅ ${settings.length} configurações padrão`);

  // ---------------------------------------------------------------------------
  // 3. Catálogo de serviços (Formatação, Limpeza, Montagem...)
  // ---------------------------------------------------------------------------
  let servicesCreated = 0;
  for (const service of DEFAULT_SERVICES) {
    const exists = await prisma.service.findUnique({ where: { name: service.name } });
    if (!exists) {
      await prisma.service.create({ data: service });
      servicesCreated++;
    }
  }
  console.log(`✅ ${servicesCreated} serviços do catálogo`);

  // ---------------------------------------------------------------------------
  // 4. Peças de exemplo (estoque inicial)
  // ---------------------------------------------------------------------------
  const sampleParts = [
    { code: 'TEL-IP13-001', name: 'Tela iPhone 13 Original', category: 'Telas', costPrice: 320, salePrice: 450, minStock: 2, quantity: 5 },
    { code: 'BAT-IP13-001', name: 'Bateria iPhone 13', category: 'Baterias', costPrice: 110, salePrice: 180, minStock: 3, quantity: 8 },
    { code: 'TEL-SGS23-001', name: 'Tela Samsung Galaxy S23', category: 'Telas', costPrice: 370, salePrice: 520, minStock: 1, quantity: 3 },
    { code: 'BAT-SGS23-001', name: 'Bateria Samsung Galaxy S23', category: 'Baterias', costPrice: 130, salePrice: 200, minStock: 2, quantity: 4 },
    { code: 'PL-MBP-M1-001', name: 'Placa Lógica MacBook Pro M1', category: 'Placas', costPrice: 900, salePrice: 1200, minStock: 1, quantity: 1 },
    { code: 'CAR-UNIV-001', name: 'Carregador Universal 65W USB-C', category: 'Acessórios', costPrice: 45, salePrice: 80, minStock: 5, quantity: 15 },
    { code: 'CAP-IP13-001', name: 'Capa Transparente iPhone 13', category: 'Acessórios', costPrice: 12, salePrice: 35, minStock: 10, quantity: 25 },
    { code: 'VID-TEMP-001', name: 'Vidro Temperado Universal 6.1"', category: 'Acessórios', costPrice: 8, salePrice: 25, minStock: 20, quantity: 50 },
    { code: 'SSD-500-NVME', name: 'SSD NVMe 500GB', category: 'Armazenamento', costPrice: 190, salePrice: 290, minStock: 3, quantity: 6 },
    { code: 'RAM-8-DDR4', name: 'Memória 8GB DDR4 3200MHz', category: 'Memórias', costPrice: 100, salePrice: 160, minStock: 4, quantity: 10 },
  ];

  for (const part of sampleParts) {
    const exists = await prisma.part.findUnique({ where: { code: part.code } });
    if (!exists) {
      await prisma.part.create({ data: { ...part, status: PartStatus.ACTIVE, unit: 'UN' } });
    }
  }
  console.log(`✅ ${sampleParts.length} peças de exemplo`);

  // ---------------------------------------------------------------------------
  // 5. Cliente de exemplo
  // ---------------------------------------------------------------------------
  const demoClient = await prisma.client.findFirst({ where: { email: 'demo@papatec.com' } });
  if (!demoClient) {
    await prisma.client.create({
      data: {
        name: 'Cliente Demonstração',
        phone: '(11) 98888-7777',
        email: 'demo@papatec.com',
        address: 'Rua das Flores, 45 - São Paulo/SP',
        notes: 'Cliente criado automaticamente pelo seed.',
      },
    });
    console.log('✅ Cliente de exemplo criado');
  }

  console.log('🎉 Seed concluído!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
