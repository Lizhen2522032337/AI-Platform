import { NotFoundException } from '@nestjs/common';
import type { DeleteResult, Repository } from 'typeorm';
import { ItemPayloadDto } from './item.dto';
import { Item } from './item.entity';
import { ItemsService } from './items.service';

function sampleItem(): Item {
  return {
    id: 1,
    name: '测试记录',
    description: '测试说明',
    createdAt: new Date('2026-07-25T00:00:00.000Z'),
    updatedAt: new Date('2026-07-25T00:00:00.000Z'),
  };
}

function createRepositoryMock(): jest.Mocked<Repository<Item>> {
  return {
    find: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<Repository<Item>>;
}

describe('ItemsService', () => {
  let repository: jest.Mocked<Repository<Item>>;
  let service: ItemsService;

  beforeEach(() => {
    repository = createRepositoryMock();
    service = new ItemsService(repository);
  });

  it('lists items in descending ID order', async () => {
    repository.find.mockResolvedValue([sampleItem()]);
    await expect(service.findAll()).resolves.toHaveLength(1);
    expect(repository.find.mock.calls[0]?.[0]).toEqual({
      order: { id: 'DESC' },
    });
  });

  it('throws a unified 404 for a missing item', async () => {
    repository.findOneBy.mockResolvedValue(null);
    await expect(service.findOne(999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates an item', async () => {
    const payload: ItemPayloadDto = {
      name: '测试记录',
      description: '测试说明',
    };
    const item = sampleItem();
    repository.create.mockReturnValue(item);
    repository.save.mockResolvedValue(item);
    await expect(service.create(payload)).resolves.toEqual(item);
  });

  it('returns 404 when delete affects no rows', async () => {
    repository.delete.mockResolvedValue({ affected: 0 } as DeleteResult);
    await expect(service.remove(999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes an existing item', async () => {
    repository.delete.mockResolvedValue({ affected: 1 } as DeleteResult);
    await expect(service.remove(1)).resolves.toBeUndefined();
  });
});
