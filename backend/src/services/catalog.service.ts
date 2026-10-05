/**
 * Catálogo padrão de serviços da assistência técnica.
 * Inserido no primeiro boot (e pelo endpoint POST /api/services/init).
 */
export interface DefaultService {
  name: string;
  description: string;
  price: number;
  category: string;
  estimatedHours: number;
}

export const DEFAULT_SERVICES: DefaultService[] = [
  {
    name: 'Formatação de Computador',
    description: 'Backup de dados, formatação do Windows, instalação de drivers e atualizações.',
    price: 120,
    category: 'SOFTWARE',
    estimatedHours: 2,
  },
  {
    name: 'Limpeza Física Completa',
    description: 'Desmontagem, limpeza interna, troca de pasta térmica e limpeza de contatos.',
    price: 80,
    category: 'HARDWARE',
    estimatedHours: 1.5,
  },
  {
    name: 'Montagem de Computador',
    description: 'Montagem completa de PC, cabeamento, instalação e testes de estresse.',
    price: 150,
    category: 'HARDWARE',
    estimatedHours: 2,
  },
  {
    name: 'Remoção de Vírus e Malware',
    description: 'Varredura completa, remoção de ameaças e otimização do sistema.',
    price: 90,
    category: 'SOFTWARE',
    estimatedHours: 1.5,
  },
  {
    name: 'Upgrade de Memória / SSD',
    description: 'Instalação de memória RAM e/ou SSD com clonagem do sistema.',
    price: 60,
    category: 'HARDWARE',
    estimatedHours: 1,
  },
  {
    name: 'Instalação de Software',
    description: 'Instalação e configuração de pacote Office, antivírus e periféricos.',
    price: 40,
    category: 'SOFTWARE',
    estimatedHours: 0.5,
  },
  {
    name: 'Recuperação de Dados',
    description: 'Tentativa de recuperação de arquivos deletados ou de disco corrompido.',
    price: 200,
    category: 'DATA_RECOVERY',
    estimatedHours: 4,
  },
  {
    name: 'Configuração de Rede',
    description: 'Configuração de roteador, cabeamento e compartilhamento de arquivos/impressora.',
    price: 100,
    category: 'NETWORK',
    estimatedHours: 1.5,
  },
  {
    name: 'Manutenção Preventiva',
    description: 'Limpeza, verificação de temperaturas, atualizações e backup de drivers.',
    price: 70,
    category: 'MAINTENANCE',
    estimatedHours: 1,
  },
  {
    name: 'Instalação de Sistema Operacional',
    description: 'Windows/Linux - instalação limpa com drivers e atualizações.',
    price: 100,
    category: 'SOFTWARE',
    estimatedHours: 2,
  },
  {
    name: 'Troca de Tela (Celular)',
    description: 'Substituição de display/touch com teste de funcionalidade.',
    price: 90,
    category: 'HARDWARE',
    estimatedHours: 1.5,
  },
  {
    name: 'Troca de Bateria (Celular)',
    description: 'Substituição de bateria com teste de carga e autonomia.',
    price: 60,
    category: 'HARDWARE',
    estimatedHours: 1,
  },
];

export async function seedDefaultServices(): Promise<number> {
  // Importação dinâmica evita ciclo de imports no boot
  const { prisma } = await import('../db/prisma');
  let created = 0;
  for (const service of DEFAULT_SERVICES) {
    const exists = await prisma.service.findUnique({ where: { name: service.name } });
    if (!exists) {
      await prisma.service.create({ data: service });
      created++;
    }
  }
  return created;
}
